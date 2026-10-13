// Offline counterpart to server.py. Storage is injected so the same rules can be tested in Node.
const clone = value => JSON.parse(JSON.stringify(value));
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keyOf = value => value.normalize('NFKC').trim().toLowerCase();
const now = () => new Date().toISOString();
const today = () => new Date(Date.now()+8*3600000).toISOString().slice(0,10);
const fail = message => { throw new Error(message); };
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const BOOK_ORDER = ['cet4','cet6','kaoyan','cet4-core','cet6-core','kaoyan-core','phrases'];
export function freshState() {
  return {schemaVersion:1,settings:{batchSize:10,order:'sequence',lastBookId:'cet4'},progress:{},unknown:{},daily:{},completedSessions:[],updatedAt:now()};
}
export class StudyEngine {
  constructor(books, storage) {
    this.books = new Map(books.map(book => [book.id, book]));
    if (BOOK_ORDER.some(id => !this.books.has(id))) fail('内置词库不完整。');
    this.storage = storage;
    const saved = storage.read();
    this.state = saved ? this.validate(JSON.parse(saved)) : freshState();
  }
  book(id, state = this.state) {
    if (id === 'unknown') return {id,title:'我的生词本',category:'unknown',core:false,description:'速刷中确认不认识的词，会自动汇总在这里。',source:'你的学习记录',sourceUrl:'',words:Object.entries(state.unknown).map(([id,word])=>({...word,id})).sort((a,b)=>b.addedAt.localeCompare(a.addedAt))};
    return this.books.get(id) || fail('没有找到这本词书。');
  }
  progress(state, id) { return state.progress[id] ||= {seen:[],rounds:0,current:null}; }
  metadata(book, state = this.state) {
    const {words, ...meta} = book, ids = new Set(words.map(w=>w.id)), p = state.progress[book.id] || {};
    return {...meta,count:ids.size,seen:(p.seen||[]).filter(id=>ids.has(id)).length,rounds:p.rounds||0,unknownCount:words.filter(w=>own(state.unknown,keyOf(w.english))).length,hasCurrent:!!p.current};
  }
  bootstrap() {
    const state = this.state;
    return {app:'word-study',token:'offline',books:BOOK_ORDER.map(id=>this.metadata(this.book(id))),unknownBook:this.metadata(this.book('unknown')),settings:clone(state.settings),todayCount:state.daily[today()]||0,totalCount:Object.values(state.daily).reduce((a,b)=>a+b,0),updatedAt:state.updatedAt};
  }
  check(state, body) {
    this.book(body.bookId, state);
    const session = this.progress(state, body.bookId).current;
    if (!session || session.id !== body.sessionId) fail('这一轮已经发生变化，请重新打开词书。');
    const selected = body.selected ?? session.selected, ids = new Set(session.words.map(w=>w.id));
    if (!Array.isArray(selected) || selected.some(id=>typeof id!=='string'||!ids.has(id))) fail('勾选内容不属于这一轮。');
    return [session,[...new Set(selected)]];
  }
  commit(candidate, importing = false) {
    candidate.updatedAt = now();
    this.storage.write(JSON.stringify(candidate), importing);
    this.state = candidate;
  }
  async request(path, body) {
    if (path === '/api/bootstrap') return this.bootstrap();
    if (path.startsWith('/api/book/')) {
      const book = this.book(decodeURIComponent(path.slice(10)));
      return clone({...book,progress:this.state.progress[book.id]||{seen:[],rounds:0,current:null}});
    }
    const state = clone(this.state);
    let result;
    if (path === '/api/settings') {
      if (!integer(body.batchSize,1,100)) fail('每轮词数请输入 1 到 100 之间的整数。');
      if (!['sequence','random'].includes(body.order)) fail('学习顺序不正确。');
      Object.assign(state.settings, {batchSize:body.batchSize,order:body.order});
      result = {settings:state.settings};
    } else if (path === '/api/start') {
      const book = this.book(body.bookId, state), progress = this.progress(state, book.id);
      state.settings.lastBookId = book.id;
      if (!progress.current) {
        const seen = new Set(progress.seen), remaining = book.words.filter(w=>!seen.has(w.id));
        if (state.settings.order === 'random') for (let i=remaining.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [remaining[i],remaining[j]]=[remaining[j],remaining[i]]; }
        const words = remaining.slice(0,state.settings.batchSize);
        if (words.length) progress.current = {id:crypto.randomUUID(),bookId:book.id,words:clone(words),selected:[],stage:'select',createdAt:now()};
      }
      result = {session:progress.current,book:this.metadata(book,state)};
    } else if (path === '/api/round/update') {
      const [session, selected] = this.check(state,body), stage = body.stage ?? session.stage;
      if (!['select','review'].includes(stage)) fail('学习步骤不正确。');
      Object.assign(session,{selected,stage}); result = {session};
    } else if (path === '/api/round/complete') {
      if (state.completedSessions.includes(body.sessionId)) return {alreadySaved:true,added:0,removed:0};
      const [session, selectedList] = this.check(state,body), selected = new Set(selectedList);
      if (session.stage !== 'review') fail('请先查看中文释义，再确认保存。');
      let added = 0, removed = 0;
      const title = this.book(session.bookId,state).title;
      for (const word of session.words) {
        const key = keyOf(word.english);
        if (selected.has(word.id)) {
          let previous = own(state.unknown,key) ? state.unknown[key] : null;
          if (!previous) {
            added++;
            previous = {english:word.english,chinese:word.chinese,phonetic:word.phonetic||'',sources:[],hits:0,addedAt:now()};
            if (state.progress.unknown) state.progress.unknown.seen = state.progress.unknown.seen.filter(id=>id!==key);
          }
          if (session.bookId !== 'unknown' && !previous.sources.includes(title)) previous.sources.push(title);
          previous.hits++; previous.updatedAt = now();
          state.unknown = {...state.unknown,[key]:previous};
        } else if (session.bookId === 'unknown' && own(state.unknown,key)) { delete state.unknown[key]; removed++; }
      }
      const progress = this.progress(state,session.bookId);
      progress.seen = [...new Set([...progress.seen,...session.words.map(w=>w.id)])];
      progress.rounds++; progress.current = null;
      state.daily[today()] = (state.daily[today()]||0) + session.words.length;
      state.completedSessions = [...state.completedSessions,session.id].slice(-200);
      result = {added,removed,unknownTotal:Object.keys(state.unknown).length,count:session.words.length};
    } else if (path === '/api/restart') {
      this.book(body.bookId,state);
      state.progress[body.bookId] = {seen:[],rounds:0,current:null}; result = {ok:true};
    } else if (path === '/api/unknown/remove') {
      if (typeof body.id !== 'string') fail('请选择需要移出的词。');
      delete state.unknown[body.id];
      const p = state.progress.unknown;
      if (p) {
        p.seen = p.seen.filter(id=>id!==body.id);
        if (p.current) {
          p.current.words = p.current.words.filter(w=>w.id!==body.id);
          p.current.selected = p.current.selected.filter(id=>id!==body.id);
          if (!p.current.words.length) p.current = null;
        }
      }
      result = {ok:true};
    } else fail('操作不存在。');
    this.commit(state);
    return clone(result);
  }
  validate(raw) {
    const bad = () => fail('备份格式不正确或词库版本不兼容，现有记录未改变。');
    if (!object(raw) || raw.schemaVersion!==1 || !object(raw.settings) || !object(raw.unknown) || !object(raw.progress) || !object(raw.daily)) bad();
    const state = freshState(), settings = raw.settings;
    if (!integer(settings.batchSize,1,100) || !['sequence','random'].includes(settings.order) || ![...BOOK_ORDER,'unknown'].includes(settings.lastBookId)) bad();
    state.settings = {batchSize:settings.batchSize,order:settings.order,lastBookId:settings.lastBookId};
    const text = (v,max=20000) => typeof v==='string' && v.length<=max;
    for (const [key, w] of Object.entries(raw.unknown)) {
      if (!object(w)||!text(w.english,500)||!w.english.trim()||key!==keyOf(w.english)||!text(w.chinese)||!text(w.phonetic||'',1000)||!Array.isArray(w.sources)||w.sources.some(s=>!text(s,200))||!integer(w.hits,0,1e9)||!text(w.addedAt,100)) bad();
      Object.defineProperty(state.unknown,key,{enumerable:true,writable:true,configurable:true,value:{english:w.english,chinese:w.chinese,phonetic:w.phonetic||'',sources:[...new Set(w.sources)],hits:w.hits,addedAt:w.addedAt,updatedAt:text(w.updatedAt,100)?w.updatedAt:w.addedAt}});
    }
    for (const [id,p] of Object.entries(raw.progress)) {
      if (![...BOOK_ORDER,'unknown'].includes(id)||!object(p)||!Array.isArray(p.seen)||p.seen.some(x=>!text(x,500))||!integer(p.rounds,0,1e9)) bad();
      const valid = new Map(this.book(id,state).words.map(w=>[w.id,w]));
      const current = p.current;
      state.progress[id] = {seen:[...new Set(p.seen)].filter(x=>valid.has(x)),rounds:p.rounds,current:null};
      if (current) {
        if (!object(current)||!text(current.id,200)||!current.id||current.bookId!==id||!['select','review'].includes(current.stage)||!Array.isArray(current.words)||current.words.length<1||current.words.length>100||current.words.some(w=>!object(w)||!valid.has(w.id))||!Array.isArray(current.selected)||!text(current.createdAt,100)) bad();
        const words = current.words.map(w=>clone(valid.get(w.id))), ids = new Set(words.map(w=>w.id));
        if (ids.size!==words.length || current.selected.some(x=>!ids.has(x))) bad();
        state.progress[id].current={id:current.id,bookId:id,words,selected:[...new Set(current.selected)],stage:current.stage,createdAt:current.createdAt};
      }
    }
    for (const [date,count] of Object.entries(raw.daily)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)||!integer(count,0,1e9)) bad();
      state.daily[date]=count;
    }
    if (!Array.isArray(raw.completedSessions)||raw.completedSessions.some(x=>!text(x,200))) bad();
    state.completedSessions=raw.completedSessions.slice(-200);
    state.updatedAt=text(raw.updatedAt,100)?raw.updatedAt:now();
    return state;
  }
  previewImport(text) {
    if (text.length>8*1024*1024) fail('备份文件超过 8 MB。');
    let raw; try { raw=JSON.parse(text); } catch { fail('请选择拾词导出的 JSON 备份文件。'); }
    return this.validate(raw);
  }
  importState(candidate) { this.commit(this.validate(candidate),true); }
  exportState() { return JSON.stringify(this.state,null,2); }
}
