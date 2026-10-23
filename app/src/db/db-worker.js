// Banco local cifrado do app (ADR 0010), revisado da Prova 3.
// Dedicated Worker com SQLite no OPFS. Cada valor é cifrado com a DEK
// (AES-256-GCM); o AAD amarra a chave do registro. Sem a DEK, nada abre.
//
// "Os dados morrem" (ADR 0012): depois de apagar, o banco é reconstruído
// num ARQUIVO NOVO com uma DEK NOVA, e o arquivo antigo é removido. No iPhone
// cada arquivo tem chave própria do sistema, destruída junto com o arquivo;
// então nem quem tiver a DEK antiga lê os restos do banco velho.
import './sqlite-config.js';
import sqlite3InitModule from '../vendor/sqlite/index.mjs';

let sqlite3;
const pools = new Map(); // nome -> utilitário do pool
let active = null; // { name, db }
let dek = null;
const enc = new TextEncoder(), dec = new TextDecoder();
const SCHEMA = 1;
const DIR_PREFIX = '.mp-'; // diretórios OPFS dos bancos

async function pool(name) {
  sqlite3 ??= await sqlite3InitModule();
  if (!pools.has(name)) pools.set(name, await sqlite3.installOpfsSAHPoolVfs({ name: `mp-${name}`, directory: `${DIR_PREFIX}${name}`, initialCapacity: 4 }));
  return pools.get(name);
}

async function openDb(name) {
  const p = await pool(name);
  const db = new p.OpfsSAHPoolDb('/mp.db');
  db.exec('PRAGMA journal_mode = DELETE; PRAGMA secure_delete = ON;');
  db.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, iv BLOB NOT NULL, ct BLOB NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, room TEXT NOT NULL, expires_at INTEGER NOT NULL,
      accepted_at INTEGER NOT NULL, iv BLOB NOT NULL, ct BLOB NOT NULL) STRICT;
    CREATE INDEX IF NOT EXISTS messages_room ON messages(room, accepted_at);`);
  const v = Number(db.selectValue("SELECT v FROM meta WHERE k = 'schema'") ?? 0);
  if (v > SCHEMA) throw new Error('banco de versão mais nova: não fazer downgrade');
  if (v < SCHEMA) db.exec({ sql: "INSERT OR REPLACE INTO meta(k, v) VALUES ('schema', ?)", bind: [String(SCHEMA)] });
  return db;
}

const needDb = () => { if (!active) throw new Error('banco não aberto'); return active.db; };
function needKey(k = dek) { if (!k) throw new Error('banco bloqueado'); return k; }

async function seal(aad, value, key = dek) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, needKey(key), enc.encode(JSON.stringify(value))));
  return { iv, ct };
}
async function unseal(aad, iv, ct) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, needKey(), ct);
  return JSON.parse(dec.decode(pt));
}
const kvAad = (k) => `mp/app/kv/v1/${k}`;
const msgAad = (id, room) => `mp/app/msg/v1/${id}/${room}`;

async function writeAll(db, key, kv, msgs) {
  db.exec('BEGIN');
  try {
    for (const [k, v] of kv) {
      const { iv, ct } = await seal(kvAad(k), v, key);
      db.exec({ sql: 'INSERT OR REPLACE INTO kv(k, iv, ct) VALUES (?, ?, ?)', bind: [k, iv, ct] });
    }
    for (const m of msgs) {
      const { iv, ct } = await seal(msgAad(m.msgId, m.room), m, key);
      db.exec({ sql: 'INSERT OR REPLACE INTO messages(id, room, expires_at, accepted_at, iv, ct) VALUES (?, ?, ?, ?, ?, ?)', bind: [m.msgId, m.room, m.expiresAt ?? 0, m.acceptedAt ?? 0, iv, ct] });
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

let staged = null; // { name, db, key } esperando a troca

const ops = {
  async open({ name }) {
    if (active?.name === name) return true;
    active = { name, db: await openDb(name) };
    return true;
  },
  setKey(k) { dek = k; return true; },
  lock() { dek = null; return true; },

  async kvGet(k) {
    const r = needDb().selectObject('SELECT iv, ct FROM kv WHERE k = ?', [k]);
    return r ? unseal(kvAad(k), r.iv, r.ct) : undefined;
  },
  async kvPut({ k, v }) {
    const db = needDb();
    if (v === undefined) { db.exec({ sql: 'DELETE FROM kv WHERE k = ?', bind: [k] }); return true; }
    const { iv, ct } = await seal(kvAad(k), v);
    db.exec({ sql: 'INSERT OR REPLACE INTO kv(k, iv, ct) VALUES (?, ?, ?)', bind: [k, iv, ct] });
    return true;
  },
  async putMessage(m) {
    const { iv, ct } = await seal(msgAad(m.msgId, m.room), m);
    needDb().exec({ sql: 'INSERT OR REPLACE INTO messages(id, room, expires_at, accepted_at, iv, ct) VALUES (?, ?, ?, ?, ?, ?)', bind: [m.msgId, m.room, m.expiresAt ?? 0, m.acceptedAt ?? 0, iv, ct] });
    return true;
  },
  async getMessage(id) {
    const r = needDb().selectObject('SELECT room, iv, ct FROM messages WHERE id = ?', [id]);
    return r ? unseal(msgAad(id, r.room), r.iv, r.ct) : undefined;
  },
  deleteMessages(ids) {
    needDb().transaction((tx) => { for (const id of ids) tx.exec({ sql: 'DELETE FROM messages WHERE id = ?', bind: [id] }); });
    return true;
  },
  async roomMessages(room) {
    const rows = needDb().selectObjects('SELECT id, room, iv, ct FROM messages WHERE room = ? ORDER BY accepted_at, id', [room]);
    const out = [];
    for (const r of rows) {
      try { out.push(await unseal(msgAad(r.id, r.room), r.iv, r.ct)); } catch { /* ilegível: não mostra */ }
    }
    return out;
  },
  purgeExpired(now) {
    const db = needDb();
    db.exec({ sql: 'DELETE FROM messages WHERE expires_at > 0 AND expires_at <= ?', bind: [now] });
    return db.changes();
  },

  // Passo 1 da rotação: copia tudo que AINDA vale para um banco novo, num
  // diretório novo, cifrado com a DEK nova. O banco atual continua intacto.
  async rebuild({ newKey, newName, now }) {
    const db = needDb();
    const kv = [];
    for (const r of db.selectObjects('SELECT k, iv, ct FROM kv')) kv.push([r.k, await unseal(kvAad(r.k), r.iv, r.ct)]);
    const msgs = [];
    for (const r of db.selectObjects('SELECT id, room, expires_at, iv, ct FROM messages')) {
      if (r.expires_at > 0 && Number.isFinite(now) && r.expires_at <= now) continue; // vencida não é copiada
      try { msgs.push(await unseal(msgAad(r.id, r.room), r.iv, r.ct)); } catch {}
    }
    if (staged) { try { staged.db.close(); } catch {} await pools.get(staged.name)?.removeVfs(); pools.delete(staged.name); }
    const ndb = await openDb(newName);
    await writeAll(ndb, newKey, kv, msgs);
    staged = { name: newName, db: ndb, key: newKey };
    return { kv: kv.length, messages: msgs.length };
  },

  // Passo 3 (depois que o app gravou o novo cofre): passa a usar o banco novo
  // e remove o diretório inteiro do antigo.
  async switchTo({ name }) {
    if (!staged || staged.name !== name) throw new Error('nada preparado para a troca');
    const old = active;
    active = { name: staged.name, db: staged.db };
    dek = staged.key;
    staged = null;
    if (old) {
      try { old.db.close(); } catch {}
      await pools.get(old.name)?.removeVfs();
      pools.delete(old.name);
    }
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
    dek = null;
    if (active) { try { active.db.close(); } catch {} }
    if (staged) { try { staged.db.close(); } catch {} }
    for (const p of pools.values()) { try { await p.removeVfs(); } catch {} }
    pools.clear();
    active = staged = null;
    return ops.cleanup({ keep: null });
  },
};

onmessage = async ({ data: { id, op, arg } }) => {
  try {
    postMessage({ id, ok: true, result: await ops[op](arg) });
  } catch (e) {
    postMessage({ id, ok: false, error: String(e?.message || e) });
  }
};
