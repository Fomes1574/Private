// Banco local cifrado do app (ADR 0010), revisado da Prova 3.
// Dedicated Worker com SQLite no OPFS. Cada valor é cifrado com a DEK
// (AES-256-GCM); o AAD amarra a chave do registro. Sem a DEK, nada abre.
import './sqlite-config.js';
import sqlite3InitModule from '../vendor/sqlite/index.mjs';

let sqlite3, pool, db, dek = null;
const enc = new TextEncoder(), dec = new TextDecoder();
const SCHEMA = 1;

async function open() {
  sqlite3 ??= await sqlite3InitModule();
  pool ??= await sqlite3.installOpfsSAHPoolVfs({ name: 'mp-pool', initialCapacity: 4 });
  db = new pool.OpfsSAHPoolDb('/mp.db');
  db.exec('PRAGMA journal_mode = DELETE; PRAGMA secure_delete = ON;');
  db.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, iv BLOB NOT NULL, ct BLOB NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, room TEXT NOT NULL, expires_at INTEGER NOT NULL,
      accepted_at INTEGER NOT NULL, iv BLOB NOT NULL, ct BLOB NOT NULL) STRICT;
    CREATE INDEX IF NOT EXISTS messages_room ON messages(room, accepted_at);`);
  const v = Number(db.selectValue("SELECT v FROM meta WHERE k = 'schema'") ?? 0);
  if (v > SCHEMA) throw new Error('banco de versão mais nova: não fazer downgrade');
  if (v < SCHEMA) db.exec({ sql: "INSERT OR REPLACE INTO meta(k, v) VALUES ('schema', ?)", bind: [String(SCHEMA)] });
}
const ready = open();

async function seal(aad, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, needKey(), enc.encode(JSON.stringify(value))));
  return { iv, ct };
}
async function unseal(aad, iv, ct) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, needKey(), ct);
  return JSON.parse(dec.decode(pt));
}
function needKey() { if (!dek) throw new Error('banco bloqueado'); return dek; }
const msgAad = (id, room) => `mp/app/msg/v1/${id}/${room}`;

const ops = {
  setKey(k) { dek = k; return true; },
  lock() { dek = null; return true; },
  async kvGet(k) {
    const r = db.selectObject('SELECT iv, ct FROM kv WHERE k = ?', [k]);
    return r ? unseal(`mp/app/kv/v1/${k}`, r.iv, r.ct) : undefined;
  },
  async kvPut({ k, v }) {
    if (v === undefined) { db.exec({ sql: 'DELETE FROM kv WHERE k = ?', bind: [k] }); return true; }
    const { iv, ct } = await seal(`mp/app/kv/v1/${k}`, v);
    db.exec({ sql: 'INSERT OR REPLACE INTO kv(k, iv, ct) VALUES (?, ?, ?)', bind: [k, iv, ct] });
    return true;
  },
  async putMessage(m) {
    const { iv, ct } = await seal(msgAad(m.msgId, m.room), m);
    db.exec({ sql: 'INSERT OR REPLACE INTO messages(id, room, expires_at, accepted_at, iv, ct) VALUES (?, ?, ?, ?, ?, ?)', bind: [m.msgId, m.room, m.expiresAt ?? 0, m.acceptedAt ?? 0, iv, ct] });
    return true;
  },
  async getMessage(id) {
    const r = db.selectObject('SELECT room, iv, ct FROM messages WHERE id = ?', [id]);
    return r ? unseal(msgAad(id, r.room), r.iv, r.ct) : undefined;
  },
  deleteMessages(ids) {
    db.transaction((tx) => { for (const id of ids) tx.exec({ sql: 'DELETE FROM messages WHERE id = ?', bind: [id] }); });
    return true;
  },
  async roomMessages(room) {
    const rows = db.selectObjects('SELECT id, room, iv, ct FROM messages WHERE room = ? ORDER BY accepted_at, id', [room]);
    const out = [];
    for (const r of rows) {
      try { out.push(await unseal(msgAad(r.id, r.room), r.iv, r.ct)); } catch { /* ilegível: não mostra */ }
    }
    return out;
  },
  // Apaga o que venceu antes de qualquer leitura (§25.6). `now` vem de fora.
  purgeExpired(now) {
    db.exec({ sql: 'DELETE FROM messages WHERE expires_at > 0 AND expires_at <= ?', bind: [now] });
    return db.changes();
  },
  async wipe() {
    dek = null;
    db.close();
    await pool.wipeFiles();
    await open();
    return true;
  },
};

onmessage = async ({ data: { id, op, arg } }) => {
  try {
    await ready;
    postMessage({ id, ok: true, result: await ops[op](arg) });
  } catch (e) {
    postMessage({ id, ok: false, error: String(e?.message || e) });
  }
};
