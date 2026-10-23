// IndexedDB pequeno, só para o que não pode ir ao banco cifrado: o registro
// do cofre (DEK embrulhada) e a chave de autenticação do aparelho (CryptoKey
// não extraível, que só o IndexedDB sabe guardar).
const DB = 'mp-app';
const open = () => new Promise((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
let dbp;
const db = () => (dbp ??= open());

export async function idbGet(k) {
  const d = await db();
  return new Promise((res, rej) => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
export async function idbPut(k, v) {
  const d = await db();
  const tx = d.transaction('kv', 'readwrite');
  if (v === undefined) tx.objectStore('kv').delete(k); else tx.objectStore('kv').put(v, k);
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
export async function idbClear() {
  const d = await db();
  const tx = d.transaction('kv', 'readwrite');
  tx.objectStore('kv').clear();
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}

// Grava várias chaves numa transação só (troca atômica de cofre + banco).
export async function idbPutMany(obj) {
  const d = await db();
  const tx = d.transaction('kv', 'readwrite');
  for (const [k, v] of Object.entries(obj)) tx.objectStore('kv').put(v, k);
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
}
