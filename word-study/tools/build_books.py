"""Build reproducible local books from the MIT-licensed ECDICT database."""
import csv
import io
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data' / 'books'
SOURCE = 'https://raw.githubusercontent.com/skywind3000/ECDICT/master/'


def build():
    OUT.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(SOURCE + 'ecdict.csv', headers={'User-Agent': 'LocalWordStudy/1.0'})
    groups = {'cet4': {}, 'cet6': {}, 'kaoyan': {}}
    with urllib.request.urlopen(request, timeout=180) as response:
        for row in csv.DictReader(io.TextIOWrapper(response, encoding='utf-8-sig')):
            tags = set(row.get('tag', '').split())
            if not tags.intersection({'cet4', 'cet6', 'ky'}):
                continue
            english = row['word'].strip()
            chinese = row.get('translation', '').replace('\\n', '\n').strip()
            if not re.fullmatch(r"[A-Za-z][A-Za-z' -]*", english) or not chinese:
                continue
            ranks = [int(row[x]) for x in ('frq', 'bnc') if row.get(x, '').isdigit() and int(row[x]) > 0]
            entry = {'id': english.casefold(), 'english': english, 'chinese': chinese,
                     'phonetic': row.get('phonetic', ''), 'frequency': min(ranks, default=999999),
                     'basic': bool(tags.intersection({'zk', 'gk'}))}
            if 'cet4' in tags:
                groups['cet4'][entry['id']] = entry
            if 'cet4' in tags or 'cet6' in tags:
                groups['cet6'][entry['id']] = entry
            if 'ky' in tags:
                groups['kaoyan'][entry['id']] = entry
    titles = {'cet4': '四级词汇', 'cet6': '六级词汇', 'kaoyan': '考研词汇'}
    limits = {'cet4': 1200, 'cet6': 1500, 'kaoyan': 2000}
    manifest = []
    for key, table in groups.items():
        entries = sorted(table.values(), key=lambda x: x['id'])
        for core in (False, True):
            book_id = key + ('-core' if core else '')
            words = entries
            if core:
                # Prioritize vocabulary beyond secondary-school basics, then public corpus frequency.
                words = sorted(entries, key=lambda x: (x['basic'], x['frequency'], x['id']))[:limits[key]]
            title = titles[key] + ('核心词汇' if core else '')
            note = '考试分类内优先选取非中高考基础词，再按 BNC / 当代语料库词频精选；不代表真题出现次数。' if core else ('包含四级基础词与六级新增词。' if key == 'cet6' else '按 ECDICT 考试分类整理。')
            book = {'id': book_id, 'title': title, 'category': key, 'core': core,
                    'description': note, 'source': 'ECDICT · MIT',
                    'sourceUrl': 'https://github.com/skywind3000/ECDICT',
                    'words': [{k: v for k, v in word.items() if k not in ('frequency', 'basic')} for word in words]}
            (OUT / (book_id + '.json')).write_text(json.dumps(book, ensure_ascii=False, indent=2), encoding='utf-8')
            manifest.append({k: v for k, v in book.items() if k != 'words'} | {'count': len(words)})
    phrases = ROOT / 'data' / 'phrases.tsv'
    words = []
    for line in phrases.read_text(encoding='utf-8').splitlines():
        if line.strip() and not line.startswith('#'):
            english, chinese = line.split('\t', 1)
            words.append({'id': english.casefold(), 'english': english, 'chinese': chinese, 'phonetic': ''})
    book = {'id': 'phrases', 'title': '常用短语', 'category': 'phrases', 'core': False,
            'description': '常见搭配、连接表达与动词短语。', 'source': '本项目整理', 'sourceUrl': '', 'words': words}
    (OUT / 'phrases.json').write_text(json.dumps(book, ensure_ascii=False, indent=2), encoding='utf-8')
    manifest.append({k: v for k, v in book.items() if k != 'words'} | {'count': len(words)})
    (OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    license_text = urllib.request.urlopen(SOURCE + 'LICENSE', timeout=30).read()
    (ROOT / 'data' / 'ECDICT-LICENSE.txt').write_bytes(license_text)
    print(json.dumps([{ 'book': x['title'], 'count': x['count']} for x in manifest], ensure_ascii=False))


if __name__ == '__main__':
    build()
