"""Loopback-only vocabulary application. User data is stored atomically in JSON."""
import argparse
import copy
import io
import json
import mimetypes
import os
import random
import secrets
import threading
import unicodedata
import uuid
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlsplit

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get('WORD_STUDY_DATA_DIR', str(ROOT / 'data' / 'user'))).resolve()
STATE_PATH = DATA / 'state.json'
LOCK = threading.RLock()
PDF_LOCK = threading.Lock()
TOKEN = secrets.token_urlsafe(32)
TZ = timezone(timedelta(hours=8))
BOOKS = {}
for file in (ROOT / 'data' / 'books').glob('*.json'):
    if file.name != 'manifest.json':
        book = json.loads(file.read_text(encoding='utf-8'))
        BOOKS[book['id']] = book
BOOK_ORDER = ['cet4', 'cet6', 'kaoyan', 'cet4-core', 'cet6-core', 'kaoyan-core', 'phrases']


def now():
    return datetime.now(TZ).isoformat(timespec='seconds')


def word_key(word):
    return unicodedata.normalize('NFKC', word).strip().casefold()


def fresh_state():
    return {'schemaVersion': 1, 'settings': {'batchSize': 10, 'order': 'sequence', 'lastBookId': 'cet4'},
            'progress': {}, 'unknown': {}, 'daily': {}, 'completedSessions': [], 'updatedAt': now()}


def load_state():
    if not STATE_PATH.exists():
        return fresh_state()
    state = json.loads(STATE_PATH.read_text(encoding='utf-8'))
    if state.get('schemaVersion') != 1 or not isinstance(state.get('unknown'), dict):
        raise ValueError('学习数据格式不正确，请保留原文件后检查 data/user/state.json。')
    return state


STATE = load_state()


def save_state(candidate):
    DATA.mkdir(parents=True, exist_ok=True)
    candidate['updatedAt'] = now()
    payload = json.dumps(candidate, ensure_ascii=False, indent=2).encode('utf-8')
    temporary = DATA / ('state.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('wb') as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        if STATE_PATH.exists():
            backup_tmp = DATA / 'state.backup.tmp'
            backup_tmp.write_bytes(STATE_PATH.read_bytes())
            os.replace(backup_tmp, DATA / 'state.backup.json')
        os.replace(temporary, STATE_PATH)
    finally:
        temporary.unlink(missing_ok=True)


def mutate(action):
    global STATE
    with LOCK:
        candidate = copy.deepcopy(STATE)
        result = action(candidate)
        save_state(candidate)
        STATE = candidate
        return result


def get_book(book_id, state):
    if book_id == 'unknown':
        words = [dict(value, id=key) for key, value in state['unknown'].items()]
        words.sort(key=lambda x: x['addedAt'], reverse=True)
        return {'id': 'unknown', 'title': '我的生词本', 'category': 'unknown', 'core': False,
                'description': '速刷中确认不认识的词，会自动汇总在这里。', 'source': '你的学习记录', 'sourceUrl': '', 'words': words}
    if book_id not in BOOKS:
        raise ValueError('没有找到这本词书。')
    return BOOKS[book_id]


def book_progress(state, book_id):
    return state['progress'].setdefault(book_id, {'seen': [], 'rounds': 0, 'current': None})


def metadata(book, state):
    progress = state['progress'].get(book['id'], {})
    ids = {x['id'] for x in book['words']}
    seen = len(ids.intersection(progress.get('seen', [])))
    return {k: v for k, v in book.items() if k != 'words'} | {
        'count': len(ids), 'seen': seen, 'rounds': progress.get('rounds', 0),
        'unknownCount': sum(word_key(x['english']) in state['unknown'] for x in book['words']),
        'hasCurrent': bool(progress.get('current'))}


def bootstrap(state):
    books = [metadata(BOOKS[key], state) for key in BOOK_ORDER]
    today = datetime.now(TZ).date().isoformat()
    return {'app': 'word-study', 'token': TOKEN, 'books': books,
            'unknownBook': metadata(get_book('unknown', state), state),
            'settings': state['settings'], 'todayCount': state['daily'].get(today, 0),
            'totalCount': sum(state['daily'].values()), 'updatedAt': state['updatedAt']}


def start_round(state, book_id):
    book = get_book(book_id, state)
    state['settings']['lastBookId'] = book_id
    progress = book_progress(state, book_id)
    if progress['current']:
        return {'session': progress['current'], 'book': metadata(book, state)}
    seen = set(progress['seen'])
    remaining = [x for x in book['words'] if x['id'] not in seen]
    if state['settings']['order'] == 'random':
        random.shuffle(remaining)
    words = remaining[:state['settings']['batchSize']]
    if not words:
        return {'session': None, 'book': metadata(book, state)}
    session = {'id': uuid.uuid4().hex, 'bookId': book_id, 'words': copy.deepcopy(words),
               'selected': [], 'stage': 'select', 'createdAt': now()}
    progress['current'] = session
    return {'session': session, 'book': metadata(book, state)}


def check_session(state, body):
    book_id = body.get('bookId')
    get_book(book_id, state)
    session = book_progress(state, book_id)['current']
    if not session or session['id'] != body.get('sessionId'):
        raise ValueError('这一轮已经发生变化，请重新打开词书。')
    selected = body.get('selected', session['selected'])
    valid = {x['id'] for x in session['words']}
    if not isinstance(selected, list) or any(not isinstance(x, str) or x not in valid for x in selected):
        raise ValueError('勾选内容不属于这一轮。')
    return session, list(dict.fromkeys(selected))


def update_round(state, body):
    session, selected = check_session(state, body)
    stage = body.get('stage', session['stage'])
    if stage not in ('select', 'review'):
        raise ValueError('学习步骤不正确。')
    session['selected'], session['stage'] = selected, stage
    return {'session': session}


def complete_round(state, body):
    if body.get('sessionId') in state['completedSessions']:
        return {'alreadySaved': True, 'added': 0, 'removed': 0}
    session, selected = check_session(state, body)
    if session['stage'] != 'review':
        raise ValueError('请先查看中文释义，再确认保存。')
    selected = set(selected)
    added, removed = 0, 0
    title = get_book(session['bookId'], state)['title']
    for word in session['words']:
        key = word_key(word['english'])
        if word['id'] in selected:
            previous = state['unknown'].get(key)
            if previous is None:
                added += 1
                previous = {k: word.get(k, '') for k in ('english', 'chinese', 'phonetic')}
                previous.update({'sources': [], 'hits': 0, 'addedAt': now()})
                unknown_progress = state['progress'].get('unknown')
                if unknown_progress:
                    unknown_progress['seen'] = [x for x in unknown_progress['seen'] if x != key]
            if title not in previous['sources'] and session['bookId'] != 'unknown':
                previous['sources'].append(title)
            previous['hits'] += 1
            previous['updatedAt'] = now()
            state['unknown'][key] = previous
        elif session['bookId'] == 'unknown' and key in state['unknown']:
            del state['unknown'][key]
            removed += 1
    progress = book_progress(state, session['bookId'])
    progress['seen'] = list(dict.fromkeys(progress['seen'] + [x['id'] for x in session['words']]))
    progress['rounds'] += 1
    progress['current'] = None
    today = datetime.now(TZ).date().isoformat()
    state['daily'][today] = state['daily'].get(today, 0) + len(session['words'])
    state['completedSessions'] = (state['completedSessions'] + [session['id']])[-200:]
    return {'added': added, 'removed': removed, 'unknownTotal': len(state['unknown']), 'count': len(session['words'])}


def update_settings(state, body):
    count = body.get('batchSize')
    order = body.get('order', state['settings']['order'])
    if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= 100:
        raise ValueError('每轮词数请输入 1 到 100 之间的整数。')
    if order not in ('sequence', 'random'):
        raise ValueError('学习顺序不正确。')
    state['settings'].update({'batchSize': count, 'order': order})
    return {'settings': state['settings']}


def restart_book(state, body):
    book_id = body.get('bookId')
    get_book(book_id, state)
    progress = book_progress(state, book_id)
    progress['seen'], progress['current'], progress['rounds'] = [], None, 0
    return {'ok': True}


def remove_unknown(state, body):
    key = body.get('id')
    if not isinstance(key, str):
        raise ValueError('请选择需要移出的词。')
    state['unknown'].pop(key, None)
    progress = state['progress'].get('unknown')
    if progress:
        progress['seen'] = [x for x in progress['seen'] if x != key]
        if progress['current']:
            progress['current']['words'] = [x for x in progress['current']['words'] if x['id'] != key]
            progress['current']['selected'] = [x for x in progress['current']['selected'] if x != key]
            if not progress['current']['words']:
                progress['current'] = None
    return {'ok': True}


def export_pdf(book):
    from html import escape
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

    font_path = Path(os.environ.get('WORD_STUDY_FONT', 'C:/Windows/Fonts/simhei.ttf'))
    if not font_path.is_file():
        raise ValueError('找不到中文字体。请设置 WORD_STUDY_FONT 为可用的中文 TTF 字体路径。')
    with PDF_LOCK:
        if 'WordChinese' not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont('WordChinese', str(font_path)))
        stream = io.BytesIO()
        doc = SimpleDocTemplate(stream, pagesize=A4, rightMargin=36, leftMargin=36,
                                topMargin=40, bottomMargin=40, title=book['title'], author='拾词 · 本地单词学习')
        chinese = ParagraphStyle('zh', fontName='WordChinese', fontSize=10, leading=15, wordWrap='CJK', alignment=TA_LEFT)
        english = ParagraphStyle('en', fontName='Helvetica', fontSize=11, leading=15, wordWrap='CJK')
        heading = ParagraphStyle('heading', parent=chinese, fontSize=20, leading=28, textColor=colors.HexColor('#182d4e'))
        small = ParagraphStyle('small', parent=chinese, fontSize=9, leading=14, textColor=colors.HexColor('#596579'))
        rows = [[Paragraph('英文', chinese), Paragraph('中文释义', chinese)]]
        for word in book['words']:
            rows.append([Paragraph(escape(word['english']), english),
                         Paragraph(escape(word['chinese']).replace('\n', '<br/>'), chinese)])
        table = Table(rows, colWidths=[173, A4[0] - 72 - 173], repeatRows=1, splitByRow=1, splitInRow=0)
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e9eef7')),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f8fafc')]),
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (0, 0), (-1, -1), 10), ('RIGHTPADDING', (0, 0), (-1, -1), 10),
            ('TOPPADDING', (0, 0), (-1, -1), 7), ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
            ('LINEBELOW', (0, 0), (-1, 0), 0.7, colors.HexColor('#bcc9db')),
            ('LINEBELOW', (0, 1), (-1, -1), 0.3, colors.HexColor('#e2e7ee')),
            ('LINEAFTER', (0, 0), (0, -1), 0.3, colors.HexColor('#d9e1ec')),
        ]))
        def footer(canvas, document):
            canvas.saveState()
            canvas.setFont('WordChinese', 9)
            canvas.setFillColor(colors.HexColor('#69768a'))
            canvas.drawString(36, 23, book['title'])
            canvas.drawRightString(A4[0] - 36, 23, f'第 {document.page} 页')
            canvas.restoreState()
        story = [Paragraph(escape(book['title']), heading),
                 Paragraph(f"共 {len(book['words'])} 个词条 · 导出日期 {datetime.now(TZ).date().isoformat()}", small),
                 Spacer(1, 8), Paragraph(escape(book['description']), small), Spacer(1, 14), table]
        doc.build(story, onFirstPage=footer, onLaterPages=footer)
        return stream.getvalue()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print(f'{self.address_string()} {format % args}', flush=True)

    def send(self, status, content, content_type='application/json; charset=utf-8', headers=None):
        if isinstance(content, (dict, list)):
            content = json.dumps(content, ensure_ascii=False).encode('utf-8')
        elif isinstance(content, str):
            content = content.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(content)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(content)

    def check_host(self):
        return self.headers.get('Host', '') in (f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}')

    def do_GET(self):
        if not self.check_host():
            self.send(403, {'error': '仅允许本机访问。'})
            return
        try:
            url = urlsplit(self.path)
            query = parse_qs(url.query)
            if url.path == '/api/bootstrap':
                with LOCK:
                    result = bootstrap(STATE)
                self.send(200, result)
            elif url.path.startswith('/api/book/'):
                with LOCK:
                    book = get_book(unquote(url.path.rsplit('/', 1)[-1]), STATE)
                    result = copy.deepcopy(book)
                    result['progress'] = copy.deepcopy(STATE['progress'].get(book['id'], {'seen': [], 'rounds': 0, 'current': None}))
                self.send(200, result)
            elif url.path == '/api/export/pdf':
                with LOCK:
                    book = copy.deepcopy(get_book(query.get('bookId', [''])[0], STATE))
                if not book['words']:
                    raise ValueError('这本词书还没有词条，先添加几个生词再导出。')
                pdf = export_pdf(book)
                self.send(200, pdf, 'application/pdf', {'Content-Disposition': "attachment; filename=wordbook.pdf; filename*=UTF-8''" + quote(book['title'] + '.pdf')})
            elif url.path == '/api/export/backup':
                with LOCK:
                    payload = json.dumps(STATE, ensure_ascii=False, indent=2)
                self.send(200, payload, headers={'Content-Disposition': 'attachment; filename=word-study-backup.json'})
            else:
                relative = 'index.html' if url.path == '/' else unquote(url.path).lstrip('/')
                static_root = ROOT / 'public'
                file = (static_root / relative).resolve()
                if not file.is_relative_to(static_root) or not file.is_file():
                    self.send(404, {'error': '页面不存在。'})
                else:
                    mime = mimetypes.guess_type(file.name)[0] or 'application/octet-stream'
                    self.send(200, file.read_bytes(), mime + ('; charset=utf-8' if mime.startswith('text/') else ''))
        except ValueError as error:
            self.send(400, {'error': str(error)})
        except Exception as error:
            print(f'GET error: {error}', flush=True)
            self.send(500, {'error': '读取或导出失败，请检查本地服务日志后重试。'})

    def do_POST(self):
        origin = self.headers.get('Origin')
        allowed = {f'http://127.0.0.1:{self.server.server_port}', f'http://localhost:{self.server.server_port}'}
        if not self.check_host() or self.headers.get('X-Study-Token') != TOKEN or (origin and origin not in allowed):
            self.send(403, {'error': '请求无效，请刷新页面后重试。'})
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size < 1 or size > 1024 * 1024:
                raise ValueError('请求内容过大或为空。')
            body = json.loads(self.rfile.read(size))
            if not isinstance(body, dict):
                raise ValueError('请求格式不正确。')
            if self.path == '/api/shutdown':
                self.send(200, {'ok': True})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return
            actions = {'/api/start': lambda state: start_round(state, body.get('bookId')),
                       '/api/round/update': lambda state: update_round(state, body),
                       '/api/round/complete': lambda state: complete_round(state, body),
                       '/api/settings': lambda state: update_settings(state, body),
                       '/api/restart': lambda state: restart_book(state, body),
                       '/api/unknown/remove': lambda state: remove_unknown(state, body)}
            if self.path not in actions:
                self.send(404, {'error': '操作不存在。'})
                return
            self.send(200, mutate(actions[self.path]))
        except (ValueError, TypeError) as error:
            self.send(400, {'error': str(error)})
        except Exception as error:
            print(f'POST error: {error}', flush=True)
            self.send(500, {'error': '未能保存到本地文件，你的当前选择仍保留在页面中，请重试。'})


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    DATA.mkdir(parents=True, exist_ok=True)
    if not STATE_PATH.exists():
        save_state(STATE)
    if len(BOOKS) != 7:
        raise RuntimeError('本地词库不完整，请先运行 tools/build_books.py。')
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'Local URL: http://127.0.0.1:{args.port}', flush=True)
    print(f'Data: {STATE_PATH}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
