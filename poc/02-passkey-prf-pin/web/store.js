// IndexedDB mínimo: um único object store chave/valor.
// Cada operação de cripto grava o estado novo numa só transação,
// junto com a mudança de fila, para não ficar estado pela metade.
const DB = 'poc2-passkey';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const dbp = openDb();

export async function getAll(keys) {
  const db = await dbp;
  const tx = db.transaction('kv', 'readonly');
  const st = tx.objectStore('kv');
  const out = {};
  await Promise.all(keys.map((k) => new Promise((res, rej) => {
    const r = st.get(k);
    r.onsuccess = () => { out[k] = r.result; res(); };
    r.onerror = () => rej(r.error);
  })));
  return out;
}

export async function putAll(obj) {
  const db = await dbp;
  const tx = db.transaction('kv', 'readwrite');
  const st = tx.objectStore('kv');
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) st.delete(k); else st.put(v, k);
  }
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}

export async function clearAll() {
  const db = await dbp;
  const tx = db.transaction('kv', 'readwrite');
  tx.objectStore('kv').clear();
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
