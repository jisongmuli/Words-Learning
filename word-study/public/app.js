const app = document.querySelector('#app');
const icons = {
  book: '<path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H4z"/><path d="M13 7a3 3 0 0 1 3-3h5v14h-4a4 4 0 0 0-4 3"/>',
  flash: '<path d="m13 2-9 12h7l-1 8 10-13h-7z"/>',
  bookmark: '<path d="M6 3h12v19l-6-4-6 4z"/>',
  settings: '<path d="M12 8v8m-4-4h8"/><circle cx="12" cy="12" r="9"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.book}</svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
let data, view = 'library', activeBook, session, selected = new Set(), busy = false;
let listBook, listPage = 1, saveQueue = Promise.resolve(), saveFailure = null;
async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : {method:'POST', headers:{'Content-Type':'application/json','X-Study-Token':data.token},body:JSON.stringify(body)});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '操作失败，请重试。');
  return result;
}
function toast(message) { const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('visible'); clearTimeout(toast.timer); toast.timer = setTimeout(()=>el.classList.remove('visible'),4000); }
async function refresh() { data = await api('/api/bootstrap'); }
function shell(content) {
  return `<aside class="sidebar"><a class="brand" href="#" data-action="library"><span class="brand-icon">${icon('book')}</span><span>拾词<small>WORD BY WORD</small></span></a><div class="nav-label">我的学习空间</div><nav><button class="nav-item ${view==='library'||view==='browse'?'active':''}" data-action="library">${icon('grid')}我的词书</button><button class="nav-item ${view==='study'?'active':''}" data-action="continue">${icon('flash')}单词速刷</button><button class="nav-item ${view==='unknown'?'active':''}" data-action="unknown">${icon('bookmark')}我的生词本<span class="nav-count">${data.unknownBook.count}</span></button></nav><div class="sidebar-bottom"><div class="local-status"><span></span>本地文件保存</div><p>每一次确认，都留下进步。</p><button class="nav-item" data-action="settings">${icon('settings')}学习设置</button></div></aside><div class="workspace"><header class="topbar"><span class="breadcrumb">学习空间 <b>/</b> ${{library:'我的词书',unknown:'我的生词本',browse:'浏览词书',study:'单词速刷'}[view]}</span><button class="setting-chip" data-action="settings">${icon('settings')}每轮 ${data.settings.batchSize} 词</button></header><main>${content}</main><footer class="page-footer"><span>拾词 · 每次专注一小组</span><span id="save-status">学习数据保存在这台电脑</span></footer></div>`;
}
function renderLibrary() {
  view = 'library';
  const coreCount = data.books.filter(x=>x.core).length;
  app.innerHTML = shell(`<div class="page-heading"><div><span class="eyebrow">YOUR WORD LIBRARY</span><h1>从一本词书开始</h1><p>选一本书，每次一小组，慢慢把陌生变熟悉。</p></div><span class="book-total">${data.books.length} 本词书</span></div><div class="stats-strip"><div><span>今天已刷</span><strong>${data.todayCount}<small>词</small></strong></div><div><span>累计已刷</span><strong>${data.totalCount}<small>词</small></strong></div><div><span>我的生词</span><strong>${data.unknownBook.count}<small>词</small></strong></div><div class="flow-note">${icon('flash')}<span>勾选陌生词<span>核对释义 · 收进生词本</span></span></div></div><section><div class="section-title"><h2>考试词汇</h2><span>完整词库 ${data.books.length-coreCount-1} 本 · 核心精选 ${coreCount} 本</span></div><div class="book-grid">${data.books.filter(x=>x.id!=='phrases').map(bookCard).join('')}</div></section><section class="phrase-section"><div class="section-title"><h2>日常积累</h2><span>把词连起来用</span></div>${bookCard(data.books.find(x=>x.id==='phrases'))}</section>`);
}
function bookCard(book) {
  const color = {cet4:'blue',cet6:'purple',kaoyan:'orange',phrases:'teal'}[book.category];
  const code = {cet4:'CET<small>4</small>',cet6:'CET<small>6</small>',kaoyan:'POST<br><span>GRAD</span>',phrases:'PHR<br><span>ASES</span>'}[book.category];
  const pct = book.count ? Math.round(book.seen/book.count*100) : 0;
  return `<article class="book-card ${color} ${book.core?'core':''} ${book.id==='phrases'?'phrase-card':''}"><div class="book-cover"><div class="cover-top">${book.core?'CORE VOCABULARY':'ENGLISH VOCABULARY'}</div><div class="cover-code">${code}</div><div class="cover-line"></div><div class="cover-bottom">${book.core?'核心精选':'循序积累'}<span>${book.count.toLocaleString()} WORDS</span></div></div><div class="book-info"><div class="book-tag">${book.core?'核心词汇':book.category==='phrases'?'常用表达':'考试词汇'}</div><h3>${esc(book.title)}</h3><div class="book-meta">${book.count.toLocaleString()} ${book.id==='phrases'?'个短语':'个单词'}<span>${book.core?'重点精选':'基础积累'}</span></div><div class="progress-row"><span>已刷 ${book.seen} / ${book.count}</span><b>${pct}%</b></div><div class="progress"><i style="width:${pct}%"></i></div><div class="book-actions"><button class="primary" data-action="start" data-book="${book.id}">${icon('flash')}${book.hasCurrent||book.seen?'继续速刷':'开始速刷'}</button><button class="icon-button" data-action="browse" data-book="${book.id}" aria-label="浏览${esc(book.title)}" title="浏览词书">${icon('book')}</button><button class="icon-button" data-action="pdf" data-book="${book.id}" aria-label="导出${esc(book.title)} PDF" title="导出 PDF">${icon('download')}</button></div></div></article>`;
}
async function start(bookId) {
  if (busy) return;
  busy = true;
  try {
    const result = await api('/api/start', {bookId});
    data.settings.lastBookId = bookId;
    activeBook = result.book; session = result.session; selected = new Set(session?.selected || []); view = 'study'; renderStudy();
  } finally { busy = false; }
}
function renderStudy() {
  const pct = activeBook.count ? Math.round(activeBook.seen/activeBook.count*100) : 0;
  app.innerHTML = shell(`<div class="page-heading"><div><span class="eyebrow">QUICK REVIEW</span><h1>${esc(activeBook.title)}</h1><p>${activeBook.id==='unknown'?'仍不认识的词继续勾选，确认后，未勾选的词会移出生词本。':'勾选不认识的词，完成后查看中文释义。'}</p></div><button class="secondary" data-action="library">返回词书</button></div><div class="study-progress"><span>已刷 ${activeBook.seen} / ${activeBook.count}</span><div class="progress"><i style="width:${pct}%"></i></div><b>${pct}%</b><button data-action="settings">调整每轮词数</button></div>${session ? `<div class="study-panel"><div class="study-header"><span class="step-label">${session.stage==='review'?'02 核对释义':'01 标记陌生词'}</span><span>本轮 ${session.words.length} 词 · 已选 <b id="selected-count">${selected.size}</b> 词</span></div><div class="word-grid">${session.words.map((word,i)=>`<label class="word-item ${selected.has(word.id)?'selected':''}"><span class="word-number">${String(i+1).padStart(2,'0')}</span><span class="word-content"><strong>${esc(word.english)}</strong>${session.stage==='review'?`<span class="phonetic">${esc(word.phonetic?'/'+word.phonetic+'/':'')}</span><span class="meaning">${esc(word.chinese).replace(/\n/g,'<br>')}</span>`:''}</span><input type="checkbox" data-word="${esc(word.id)}" ${selected.has(word.id)?'checked':''} aria-label="不认识 ${esc(word.english)}"><span class="word-check">${icon('check')}</span></label>`).join('')}</div><div class="study-footer"><div><p>${session.stage==='review'?(activeBook.id==='unknown'?'未勾选的词表示已认识，确认后会移出生词本。':'核对后可以修正勾选，再确认保存。'):'勾选的词表示不认识，先凭记忆判断。'}</p>${session.stage==='review'?'<button class="text-button" data-action="back-to-select">返回英文继续判断</button>':''}</div><button class="primary" data-action="${session.stage==='review'?'complete':'reveal'}">${session.stage==='review'?'确认保存并下一轮':'查看全部释义'}</button></div></div>` : `<div class="empty-state">${icon('check')}<h2>${activeBook.count?'这本书已经刷完了':'生词本还是空的'}</h2><p>${activeBook.count?'这一遍已经完成，可以复习生词，也可以重新刷一遍。':'先选一本词书开始速刷，确认的陌生词会汇总到这里。'}</p><div class="empty-actions">${activeBook.count?'<button class="primary" data-action="restart">重新速刷</button>':'<button class="primary" data-action="library">去选词书</button>'}${activeBook.id!=='unknown'&&data.unknownBook.count?'<button class="secondary" data-action="unknown">复习生词</button>':''}</div></div>`}`);
}
function setSaveStatus(message) { const el = document.querySelector('#save-status'); if(el) el.textContent = message; }
function queueSelectionSave() {
  const body = {bookId:session.bookId, sessionId:session.id, selected:[...selected], stage:session.stage};
  setSaveStatus('正在保存勾选……');
  saveQueue = saveQueue.then(async()=>{
    try { await api('/api/round/update',body); saveFailure=null; setSaveStatus('勾选已保存到本地'); }
    catch(error) { saveFailure=error; setSaveStatus('保存失败，当前选择仍保留'); toast(error.message); }
  });
}
async function flushSelection() {
  await saveQueue;
  if(saveFailure && session) {
    await api('/api/round/update',{bookId:session.bookId,sessionId:session.id,selected:[...selected],stage:session.stage});
    saveFailure=null;
  }
}
async function stageRound(stage) {
  if(busy||!session) return;
  busy=true;
  try {
    await flushSelection();
    const result=await api('/api/round/update',{bookId:session.bookId,sessionId:session.id,selected:[...selected],stage});
    session=result.session; renderStudy();
  } finally { busy=false; }
}
async function completeRound() {
  if(busy||!session) return;
  busy=true;
  try {
    await flushSelection();
    const result=await api('/api/round/complete',{bookId:session.bookId,sessionId:session.id,selected:[...selected]});
    const bookId=activeBook.id;
    session=null;
    await refresh();
    const next=await api('/api/start',{bookId});
    activeBook=next.book; session=next.session; selected=new Set(session?.selected||[]); renderStudy();
    toast(result.removed?`已复习 ${result.count} 词，${result.removed} 词移出生词本`:result.added?`已保存，${result.added} 个新词加入生词本`:`已保存本轮，生词本共 ${data.unknownBook.count} 词`);
  } finally { busy=false; }
}
async function openList(bookId) {
  await flushSelection(); await refresh();
  listBook=await api('/api/book/'+encodeURIComponent(bookId)); listPage=1;
  view=bookId==='unknown'?'unknown':'browse'; renderList();
}
function renderList() {
  const total=listBook.words.length, pages=Math.max(1,Math.ceil(total/50)); listPage=Math.max(1,Math.min(listPage,pages));
  const words=listBook.words.slice((listPage-1)*50,listPage*50), unknown=view==='unknown';
  app.innerHTML=shell(`<div class="page-heading"><div><span class="eyebrow">${unknown?'YOUR PERSONAL COLLECTION':'INSIDE THE WORDBOOK'}</span><h1>${esc(listBook.title)}</h1><p>${unknown?'每一个生词，都有机会成为熟词。':`${total.toLocaleString()} 个词条 · 英文与中文对照`}</p></div>${unknown?'':'<button class="secondary" data-action="library">返回词书</button>'}</div><div class="list-toolbar"><span>${unknown?`共 <b>${total}</b> 个生词`:'完整词书'}</span><div><button class="secondary" data-action="pdf" data-book="${listBook.id}" ${total?'':'disabled'}>${icon('download')}导出 PDF</button><button class="primary" data-action="start" data-book="${listBook.id}" ${total?'':'disabled'}>${icon('flash')}${unknown?'速刷生词':'开始速刷'}</button></div></div>${!unknown?`<div class="source-note">${esc(listBook.description)} <span>来源：${listBook.sourceUrl?`<a href="${esc(listBook.sourceUrl)}" target="_blank" rel="noreferrer">${esc(listBook.source)}</a>`:esc(listBook.source)}</span></div>`:''}${total?`<div class="table-wrap"><table class="word-table"><thead><tr><th>英文</th><th>中文释义</th>${unknown?'<th class="source-column">来源 / 操作</th>':''}</tr></thead><tbody>${words.map(word=>`<tr><td><strong>${esc(word.english)}</strong>${word.phonetic?`<span class="phonetic">/${esc(word.phonetic)}/</span>`:''}</td><td>${esc(word.chinese).replace(/\n/g,'<br>')}</td>${unknown?`<td class="source-column"><span class="word-source">${esc((word.sources||[]).join('、')||'生词复习')}</span><button class="text-button" data-action="remove" data-word-id="${esc(word.id)}">已认识，移出</button></td>`:''}</tr>`).join('')}</tbody></table></div><div class="pagination"><span>第 ${(listPage-1)*50+1}–${Math.min(listPage*50,total)} 条 / 共 ${total} 条</span><div><button class="secondary" data-action="previous-page" ${listPage===1?'disabled':''}>上一页</button><span>${listPage} / ${pages}</span><button class="secondary" data-action="next-page" ${listPage===pages?'disabled':''}>下一页</button></div></div>`:`<div class="empty-state">${icon('bookmark')}<h2>生词本还是空的</h2><p>选择词书速刷，确认不认识的词会自动出现在这里。</p><button class="primary" data-action="library">去选词书</button></div>`}`);
}
function openSettings() {
  const dialog=document.querySelector('#settings-dialog');
  dialog.innerHTML=`<form id="settings-form"><div class="dialog-heading"><div><span class="eyebrow">LEARNING PREFERENCES</span><h2 id="settings-title">按你的节奏学习</h2></div><button type="button" class="icon-button" data-dialog-close aria-label="关闭设置">${icon('close')}</button></div><label class="field-label" for="batch-size">每轮给我几个词</label><div class="number-field"><input id="batch-size" name="batchSize" type="number" min="1" max="100" step="1" value="${data.settings.batchSize}" required><span>词 / 轮</span></div><div class="presets">${[5,10,20,30,50].map(n=>`<button type="button" data-preset="${n}" class="${n===data.settings.batchSize?'chosen':''}">${n} 词</button>`).join('')}</div><p class="field-help">可设置 1–100 词。当前轮保持原词数，下轮开始生效。</p><label class="field-label" for="study-order">学习顺序</label><select id="study-order" name="order"><option value="sequence" ${data.settings.order==='sequence'?'selected':''}>按词书顺序</option><option value="random" ${data.settings.order==='random'?'selected':''}>随机选取未刷词</option></select><div class="backup-option"><span>学习数据备份<small>包含设置、进度和生词本</small></span><button type="button" class="secondary" id="backup-button">下载备份</button></div><div id="settings-error" class="form-error" role="alert"></div><button type="submit" class="primary full-width">保存设置</button></form>`;
  dialog.showModal();
}
async function downloadFile(url,fallbackName) {
  toast('正在准备导出文件……');
  const response=await fetch(url);
  if(!response.ok) { const error=await response.json(); throw new Error(error.error); }
  const blob=await response.blob();
  const objectUrl=URL.createObjectURL(blob), anchor=document.createElement('a');
  anchor.href=objectUrl; anchor.download=fallbackName; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(objectUrl),10000); toast('文件已导出，请查看浏览器下载');
}
async function confirmAction(title,message,action) {
  const dialog=document.querySelector('#confirm-dialog');
  dialog.innerHTML=`<h2 id="confirm-title">${esc(title)}</h2><p>${esc(message)}</p><div class="dialog-actions"><button class="secondary" data-dialog-close>取消</button><button class="primary" id="confirm-action">确认</button></div><p id="confirm-error" class="form-error" role="alert"></p>`;
  dialog.showModal();
  document.querySelector('#confirm-action').onclick=async(event)=> { event.target.disabled=true; try { await action(); dialog.close(); } catch(error) { document.querySelector('#confirm-error').textContent=error.message; event.target.disabled=false; } };
}
app.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  event.preventDefault();
  try {
    const action = button.dataset.action;
    if(busy) return;
    if (action==='library') { await flushSelection(); await refresh(); renderLibrary(); }
    else if(action==='start') { await flushSelection(); await start(button.dataset.book); }
    else if(action==='continue') { await flushSelection(); await start(data.settings.lastBookId); }
    else if(action==='reveal') await stageRound('review');
    else if(action==='back-to-select') await stageRound('select');
    else if(action==='complete') await completeRound();
    else if(action==='settings') openSettings();
    else if(action==='unknown') await openList('unknown');
    else if(action==='browse') await openList(button.dataset.book);
    else if(action==='pdf') { button.disabled=true; try { await downloadFile('/api/export/pdf?bookId='+encodeURIComponent(button.dataset.book),(data.books.find(x=>x.id===button.dataset.book)?.title||'我的生词本')+'.pdf'); } finally { button.disabled=false; } }
    else if(action==='previous-page'||action==='next-page') { listPage+=action==='next-page'?1:-1; renderList(); window.scrollTo({top:0,behavior:'smooth'}); }
    else if(action==='restart') await confirmAction('重新速刷这本书？','将开始新一遍速刷，生词本中的词会保留。',async()=> { await api('/api/restart',{bookId:activeBook.id}); await refresh(); await start(activeBook.id); });
    else if(action==='remove') await confirmAction('这个词已经认识了？','确认后会将它移出生词本。',async()=>{await api('/api/unknown/remove',{id:button.dataset.wordId});await openList('unknown');toast('已移出生词本');});
  } catch(error) { toast(error.message); }
});
app.addEventListener('change', event=> { if(event.target.matches('[data-word]')) { const id=event.target.dataset.word; if(busy){event.target.checked=selected.has(id);return;} event.target.checked ? selected.add(id) : selected.delete(id); event.target.closest('.word-item').classList.toggle('selected',event.target.checked); document.querySelector('#selected-count').textContent = selected.size; queueSelectionSave(); } });
document.addEventListener('click',async event=>{
  if(event.target.closest('[data-dialog-close]')) event.target.closest('dialog').close();
  const preset=event.target.closest('[data-preset]');
  if(preset){document.querySelector('#batch-size').value=preset.dataset.preset;document.querySelectorAll('[data-preset]').forEach(button=>button.classList.toggle('chosen',button===preset));}
  if(event.target.closest('#backup-button')){try{await flushSelection();await downloadFile('/api/export/backup','拾词学习备份.json');}catch(error){toast(error.message);}}
});
document.addEventListener('submit',async event=>{
  if(event.target.id!=='settings-form')return;
  event.preventDefault();const button=event.target.querySelector('[type=submit]');button.disabled=true;
  try{
    await api('/api/settings',{batchSize:Number(document.querySelector('#batch-size').value),order:document.querySelector('#study-order').value});
    await refresh();document.querySelector('#settings-dialog').close();
    if(view==='library')renderLibrary();else if(view==='study')renderStudy();else renderList();
    toast('已保存设置，下轮使用新词数');
  }catch(error){document.querySelector('#settings-error').textContent=error.message;}finally{button.disabled=false;}
});
// Expose the same navigation through WebMCP when the browser supports it.
if(document.modelContext?.registerTool){
  const controller=new AbortController();window.addEventListener('pagehide',()=>controller.abort(),{once:true});
  for(const tool of [
    {name:'read_word_study_summary',description:'Read wordbook sizes, local progress and the unknown-word count.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:async()=>{await refresh();return {books:data.books,unknownCount:data.unknownBook.count,settings:data.settings};}},
    {name:'start_wordbook_review',description:'Open or resume a review round for a local wordbook. Does not complete a round.',inputSchema:{type:'object',properties:{bookId:{type:'string'}},required:['bookId'],additionalProperties:false},annotations:{readOnlyHint:false},execute:async input=>{if(!input||typeof input.bookId!=='string'||!['unknown',...data.books.map(x=>x.id)].includes(input.bookId))throw new Error('Invalid wordbook');await flushSelection();await start(input.bookId);return {bookId:activeBook.id,sessionId:session?.id||null,count:session?.words.length||0};}}
  ]){try{Promise.resolve(document.modelContext.registerTool(tool,{signal:controller.signal})).catch(()=>{});}catch{}}
}
try { await refresh(); renderLibrary(); } catch(error) { app.innerHTML = `<div class="load-error"><h1>暂时无法打开词书</h1><p>${esc(error.message)}</p><button onclick="location.reload()">重新加载</button></div>`; }
