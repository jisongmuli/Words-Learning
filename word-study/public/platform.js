export const isAndroid = !!globalThis.AndroidStudy;
let engine;
export async function mobileEngine() {
  if (engine) return engine;
  const {StudyEngine} = await import('./mobile-engine.mjs');
  const books = await Promise.all(['cet4','cet6','kaoyan','cet4-core','cet6-core','kaoyan-core','phrases'].map(async id=>{
    const response = await fetch('/books/'+id+'.json');
    if (!response.ok) throw new Error('内置词库读取失败。');
    return response.json();
  }));
  const check = result => {const r=JSON.parse(result);if(!r.ok)throw new Error(r.error);return r.value;};
  engine = new StudyEngine(books,{read:()=>check(AndroidStudy.loadState()),write:(text,importing)=>check(AndroidStudy.saveState(text,importing))});
  return engine;
}
const pending = new Map();
globalThis.onNativeFileResult = (id,result) => {
  const call = pending.get(id); if (!call) return; pending.delete(id);
  result.ok ? call.resolve(result) : call.reject(new Error(result.error||'文件操作失败，请重试。'));
};
export function nativeFile(action, payload = '') {
  return new Promise((resolve,reject)=>{
    const id=crypto.randomUUID(); pending.set(id,{resolve,reject});
    try { AndroidStudy.fileOperation(id,action,payload); } catch(e) { pending.delete(id); reject(e); }
  });
}
