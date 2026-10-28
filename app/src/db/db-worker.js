// Banco local cifrado do app (ADR 0010), revisado da Prova 3.
// Dedicated Worker com SQLite no OPFS. Cada valor é cifrado com a DEK
// (AES-256-GCM); o AAD amarra a chave do registro. Sem a DEK, nada abre.
//
// Sem metadado em claro (ADR 0014): ids de mensagem e de conversa viram
// HMAC com uma chave que mora cifrada aqui dentro (e é trocada a cada
// rotação); datas e tamanhos ficam dentro da cifra, e cada registro é
// preenchido até múltiplos de 256 bytes. Quem copia o arquivo vê só blocos
// opacos do mesmo jeito: não dá para contar por conversa nem por horário.
//
// "Os dados morrem" (ADR 0012): depois de apagar, o banco é reconstruído
// num ARQUIVO NOVO com uma DEK NOVA, e o arquivo antigo é removido. No iPhone
// cada arquivo tem chave própria do sistema, destruída junto com o arquivo;
// então nem quem tiver a DEK antiga lê os restos do banco velho.
import './sqlite-config.js';
import sqlite3InitModule from '../vendor/sqlite/index.mjs';
import { operationQueue } from './operation-queue.js';

let sqlite3;
const pools = new Map(); // nome -> utilitário do pool
let active = null; // { name, db }
let dek = null;
let idx = null; // chave HMAC dos índices cegos
const enc = new TextEncoder(), dec = new TextDecoder();
const SCHEMA = 2;
const DIR_PREFIX = '.mp-'; // diretórios OPFS dos bancos

async function pool(name) {
  sqlite3 ??= await sqlite3InitModule();
  if (!pools.has(name)) pools.set(name, await sqlite3.installOpfsSAHPoolVfs({ name: `mp-${name}`, directory: `${DIR_PREFIX}${name}`, initialCapacity: 4 }));
  return pools.get(name);
}

async function openDb(name) {
  const p = await pool(name);
  const db = new p.OpfsSAHPoolDb('/mp.db');
  // temp_store em memória: nada de arquivo temporário do SQLite no disco.
  db.exec('PRAGMA journal_mode = DELETE; PRAGMA secure_delete = ON; PRAGMA temp_store = MEMORY;');
  db.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) STRICT;');
  const v = Number(db.selectValue("SELECT v FROM meta WHERE k = 'schema'") ?? 0);
  if (v > SCHEMA) throw new Error('banco de versão mais nova: não fazer downgrade');
  // Esquema 1 guardava ids e datas em claro. NADA é apagado aqui: as tabelas
  // antigas só mudam de nome e são convertidas quando a chave chega
  // (setKey → migrateV1); depois o arquivo inteiro é refeito (rotação).
  if (v === 1 && db.selectValue("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'kv'")) {
    db.exec('BEGIN; ALTER TABLE kv RENAME TO kv_v1; ALTER TABLE messages RENAME TO messages_v1; DROP INDEX IF EXISTS messages_room; COMMIT;');
  }
  db.exec(`CREATE TABLE IF NOT EXISTS kv (k BLOB PRIMARY KEY, iv BLOB NOT NULL, ct BLOB NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS messages (id BLOB PRIMARY KEY, room BLOB NOT NULL, iv BLOB NOT NULL, ct BLOB NOT NULL) STRICT;
    CREATE INDEX IF NOT EXISTS messages_room ON messages(room);`);
  if (v < SCHEMA) db.exec({ sql: "INSERT OR REPLACE INTO meta(k, v) VALUES ('schema', ?)", bind: [String(SCHEMA)] });
  return db;
}

const needDb = () => { if (!active) throw new Error('banco não aberto'); return active.db; };
function needKey(k = dek) { if (!k) throw new Error('banco bloqueado'); return k; }

// Preenchimento: 4 bytes de tamanho + dados + zeros até múltiplo de 256.
const PAD = 256;
function pad(bytes) {
  const out = new Uint8Array(Math.ceil((bytes.length + 4) / PAD) * PAD);
  new DataView(out.buffer).setUint32(0, bytes.length);
  out.set(bytes, 4);
  return out;
}
function unpad(bytes) {
  const n = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0);
  if (n > bytes.length - 4) throw new Error('registro adulterado');
  return bytes.subarray(4, 4 + n);
}
async function seal(aad, value, key = dek) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = pad(enc.encode(JSON.stringify(value)));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, needKey(key), pt));
  pt.fill(0);
  return { iv, ct };
}
async function unseal(aad, iv, ct, key = dek) {
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, needKey(key), ct));
  try { return JSON.parse(dec.decode(unpad(pt))); } finally { pt.fill(0); }
}
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
// Índice cego: HMAC(idx, rótulo). O AAD amarra o registro ao seu índice.
async function blind(label, key = idx) {
  if (!key) throw new Error('banco bloqueado');
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(label)));
}
const IDX_ROW = new Uint8Array([0]); // única chave fixa: a da própria chave de índice
const kvAad = (kb) => `mp/app/kv/v2/${hex(kb)}`;
const msgAad = (idb, roomb) => `mp/app/msg/v2/${hex(idb)}/${hex(roomb)}`;
const importIdx = (raw) => crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

// Lê (ou cria) a chave dos índices, guardada cifrada pela DEK.
async function loadIdx(db, key) {
  const r = db.selectObject('SELECT iv, ct FROM kv WHERE k = ?', [IDX_ROW]);
  let raw;
  if (r) raw = Uint8Array.from(atob(await unseal(kvAad(IDX_ROW), r.iv, r.ct, key)), (c) => c.charCodeAt(0));
  else {
    raw = crypto.getRandomValues(new Uint8Array(32));
    const { iv, ct } = await seal(kvAad(IDX_ROW), btoa(String.fromCharCode(...raw)), key);
    db.exec({ sql: 'INSERT OR REPLACE INTO kv(k, iv, ct) VALUES (?, ?, ?)', bind: [IDX_ROW, iv, ct] });
  }
  try { return await importIdx(raw); } finally { raw.fill(0); }
}

async function writeAll(db, key, ikey, kv, msgs) {
  db.exec('BEGIN');
  try {
    for (const [k, v] of kv) {
      const kb = await blind(`kv/${k}`, ikey);
      const { iv, ct } = await seal(kvAad(kb), { _k: k, v }, key);
      db.exec({ sql: 'INSERT OR REPLACE INTO kv(k, iv, ct) VALUES (?, ?, ?)', bind: [kb, iv, ct] });
    }
    for (const m of msgs) {
      const idb = await blind(`m/${m.msgId}`, ikey), roomb = await blind(`r/${m.room}`, ikey);
      const { iv, ct } = await seal(msgAad(idb, roomb), m, key);
      db.exec({ sql: 'INSERT OR REPLACE INTO messages(id, room, iv, ct) VALUES (?, ?, ?, ?)', bind: [idb, roomb, iv, ct] });
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Converte o esquema 1 (ids e datas em claro, sem preenchimento) para o 2,
// registro por registro, numa transação. Devolve quantos registros migrou.
async function migrateV1(db) {
  if (!db.selectValue("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'kv_v1'")) return 0;
  const openV1 = async (aad, iv, ct) => JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, needKey(), ct)));
  const kv = [], msgs = [];
  for (const r of db.selectObjects('SELECT k, iv, ct FROM kv_v1')) kv.push([r.k, await openV1(`mp/app/kv/v1/${r.k}`, r.iv, r.ct)]);
  for (const r of db.selectObjects('SELECT id, room, iv, ct FROM messages_v1')) {
    try { msgs.push(await openV1(`mp/app/msg/v1/${r.id}/${r.room}`, r.iv, r.ct)); } catch { /* ilegível: não migra */ }
  }
  const rows = [];
  for (const [k, v] of kv) {
    const kb = await blind(`kv/${k}`);
    rows.push(['kv', kb, null, await seal(kvAad(kb), { _k: k, v })]);
  }
  for (const m of msgs) {
    const idb = await blind(`m/${m.msgId}`), roomb = await blind(`r/${m.room}`);
    rows.push(['m', idb, roomb, await seal(msgAad(idb, roomb), m)]);
  }
  db.exec('BEGIN');
  try {
    for (const [t, a, b, { iv, ct }] of rows) {
      if (t === 'kv') db.exec({ sql: 'INSERT OR REPLACE INTO kv(k, iv, ct) VALUES (?, ?, ?)', bind: [a, iv, ct] });
      else db.exec({ sql: 'INSERT OR REPLACE INTO messages(id, room, iv, ct) VALUES (?, ?, ?, ?)', bind: [a, b, iv, ct] });
    }
    db.exec('DROP TABLE kv_v1; DROP TABLE messages_v1;');
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return kv.length + msgs.length;
}

let staged = null; // { name, db, key, idx } esperando a troca
// E3: prazo das mensagens já abertas, só na memória do worker e só com o
// banco destrancado (sai ao trancar ou trocar de chave). Assim a limpeza das
// vencidas decifra só o que é novo; no arquivo o prazo continua cifrado.
const expiry = new Map(); // hex(id cego) -> expiresAt

const ops = {
  async open({ name }) {
    if (active?.name === name) return true;
    active = { name, db: await openDb(name) };
    return true;
  },
  async setKey(k) {
    expiry.clear();
    dek = k;
    idx = await loadIdx(needDb(), k);
    return { migrated: await migrateV1(needDb()) };
  },
  lock() { dek = null; idx = null; expiry.clear(); return true; },

  async kvGet(k) {
    const kb = await blind(`kv/${k}`);
    const r = needDb().selectObject('SELECT iv, ct FROM kv WHERE k = ?', [kb]);
    return r ? (await unseal(kvAad(kb), r.iv, r.ct)).v : undefined;
  },
  async kvPut({ k, v }) {
    const db = needDb();
    const kb = await blind(`kv/${k}`);
    if (v === undefined) { db.exec({ sql: 'DELETE FROM kv WHERE k = ?', bind: [kb] }); return true; }
    const { iv, ct } = await seal(kvAad(kb), { _k: k, v });
    db.exec({ sql: 'INSERT OR REPLACE INTO kv(k, iv, ct) VALUES (?, ?, ?)', bind: [kb, iv, ct] });
    return true;
  },
  async putMessage(m) {
    const idb = await blind(`m/${m.msgId}`), roomb = await blind(`r/${m.room}`);
    const { iv, ct } = await seal(msgAad(idb, roomb), m);
    needDb().exec({ sql: 'INSERT OR REPLACE INTO messages(id, room, iv, ct) VALUES (?, ?, ?, ?)', bind: [idb, roomb, iv, ct] });
    expiry.set(hex(idb), m.expiresAt ?? 0);
    return true;
  },
  async getMessage(id) {
    const idb = await blind(`m/${id}`);
    const r = needDb().selectObject('SELECT room, iv, ct FROM messages WHERE id = ?', [idb]);
    return r ? unseal(msgAad(idb, r.room), r.iv, r.ct) : undefined;
  },
  async deleteMessages(ids) {
    const blinded = [];
    for (const id of ids) blinded.push(await blind(`m/${id}`));
    needDb().transaction((tx) => { for (const b of blinded) tx.exec({ sql: 'DELETE FROM messages WHERE id = ?', bind: [b] }); });
    for (const b of blinded) expiry.delete(hex(b));
    return true;
  },
  async roomMessages(room) {
    const roomb = await blind(`r/${room}`);
    const rows = needDb().selectObjects('SELECT id, room, iv, ct FROM messages WHERE room = ?', [roomb]);
    // E3: decifra em paralelo (a WebCrypto usa vários núcleos).
    const out = (await Promise.all(rows.map((r) => unseal(msgAad(r.id, r.room), r.iv, r.ct).catch(() => null)))).filter(Boolean); // ilegível: não mostra
    // A ordem vem de dentro da cifra (não há data em claro no arquivo).
    return out.sort((a, b) => (a.acceptedAt ?? 0) - (b.acceptedAt ?? 0) || (a.msgId < b.msgId ? -1 : 1));
  },
  // Vencidas: o prazo está dentro da cifra; abre, confere e apaga.
  async purgeExpired(now) {
    const db = needDb();
    const rows = db.selectObjects('SELECT id FROM messages').map((r) => ({ id: r.id, h: hex(r.id) }));
    const fresh = rows.filter((r) => !expiry.has(r.h)).map((r) => ({ ...r, ...db.selectObject('SELECT room, iv, ct FROM messages WHERE id = ?', [r.id]) }));
    const opened = await Promise.all(fresh.map((r) => unseal(msgAad(r.id, r.room), r.iv, r.ct).catch(() => null)));
    // Ilegível também sai (fica marcado como vencido).
    fresh.forEach((r, i) => expiry.set(r.h, opened[i] ? opened[i].expiresAt ?? 0 : -1));
    const gone = (e) => e === -1 || (e > 0 && e <= now);
    const dead = rows.filter((r) => gone(expiry.get(r.h))).map((r) => r.id);
    for (const r of rows) if (gone(expiry.get(r.h))) expiry.delete(r.h);
    if (dead.length) db.transaction((tx) => { for (const b of dead) tx.exec({ sql: 'DELETE FROM messages WHERE id = ?', bind: [b] }); });
    return dead.length;
  },

  // Passo 1 da rotação: copia tudo que AINDA vale para um banco novo, num
  // diretório novo, cifrado com a DEK nova. O banco atual continua intacto.
  async rebuild({ newKey, newName, now }) {
    const db = needDb();
    const kv = [];
    // Os nomes do kv não estão em claro: o banco guarda o nome lógico
    // dentro do próprio valor cifrado (campo _k).
    for (const r of db.selectObjects('SELECT k, iv, ct FROM kv')) {
      if (r.k.length === 1) continue; // chave de índice: o banco novo ganha outra
      const v = await unseal(kvAad(r.k), r.iv, r.ct);
      if (v && typeof v === 'object' && '_k' in v) kv.push([v._k, v.v]);
    }
    const msgs = [];
    for (const r of db.selectObjects('SELECT id, room, iv, ct FROM messages')) {
      let m;
      try { m = await unseal(msgAad(r.id, r.room), r.iv, r.ct); } catch { continue; }
      if (m.expiresAt > 0 && Number.isFinite(now) && m.expiresAt <= now) continue; // vencida não é copiada
      msgs.push(m);
    }
    if (staged) { try { staged.db.close(); } catch {} await pools.get(staged.name)?.removeVfs(); pools.delete(staged.name); }
    const ndb = await openDb(newName);
    // Chave de índice nova: nem os índices cegos se repetem entre arquivos.
    const nidx = await loadIdx(ndb, newKey);
    await writeAll(ndb, newKey, nidx, kv, msgs);
    staged = { name: newName, db: ndb, key: newKey, idx: nidx };
    return { kv: kv.length, messages: msgs.length };
  },

  // Passo 3 (depois que o app gravou o novo cofre): passa a usar o banco novo
  // e remove o diretório inteiro do antigo.
  async switchTo({ name }) {
    if (!staged || staged.name !== name) throw new Error('nada preparado para a troca');
    const old = active;
    active = { name: staged.name, db: staged.db };
    dek = staged.key;
    idx = staged.idx;
    staged = null;
    expiry.clear(); // ids cegos mudam com a chave nova
    if (old) {
      try { old.db.close(); } catch {}
      // A troca já foi confirmada no cofre. Falha na limpeza antiga não
      // desfaz a troca; cleanup() retoma a remoção no próximo desbloqueio.
      await pools.get(old.name)?.removeVfs().catch(() => {});
      pools.delete(old.name);
    }
    return true;
  },

  async abortRebuild() {
    if (!staged) return true;
    const old = staged; staged = null;
    try { old.db.close(); } catch {}
    // O cofre ainda aponta para o banco anterior. Falha ao remover a cópia
    // órfã não pode manter as escritas presas na barreira; cleanup() retoma
    // essa remoção no próximo desbloqueio, como na troca confirmada.
    await pools.get(old.name)?.removeVfs().catch(() => {}); pools.delete(old.name);
    return true;
  },

  // Remove bancos órfãos (queda no meio de uma rotação) ou todos (keep=null).
  async cleanup({ keep }) {
    const root = await navigator.storage.getDirectory();
    const removed = [];
    for await (const [name] of root.entries()) {
      if (!name.startsWith(DIR_PREFIX) || name === `${DIR_PREFIX}${keep}`) continue;
      const short = name.slice(DIR_PREFIX.length);
      if (pools.has(short)) { try { await pools.get(short).removeVfs(); } catch {} pools.delete(short); }
      try { await root.removeEntry(name, { recursive: true }); } catch {}
      removed.push(short);
    }
    return removed;
  },

  async wipe() {
    dek = null; idx = null; expiry.clear();
    if (active) { try { active.db.close(); } catch {} }
    if (staged) { try { staged.db.close(); } catch {} }
    for (const p of pools.values()) { try { await p.removeVfs(); } catch {} }
    pools.clear();
    active = staged = null;
    return ops.cleanup({ keep: null });
  },
};

const enqueue = operationQueue(ops, (result) => postMessage(result));
onmessage = ({ data }) => { enqueue(data); };
