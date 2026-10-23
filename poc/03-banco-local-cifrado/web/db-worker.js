// Dedicated Worker com SQLite WASM no OPFS (VFS opfs-sahpool).
// Só este worker toca no arquivo; a página conversa por mensagens.
import './sqlite-config.js';
import sqlite3InitModule from './vendor/sqlite/index.mjs';
import * as core from './db-core.js';

let sqlite3, pool, db, key = null;
const FILE = '/mensagens.db';

async function open() {
  sqlite3 ??= await sqlite3InitModule();
  pool ??= await sqlite3.installOpfsSAHPoolVfs({ name: 'mp-pool', initialCapacity: 4 });
  db = new pool.OpfsSAHPoolDb(FILE);
  db.exec('PRAGMA journal_mode = DELETE; PRAGMA secure_delete = ON;');
  core.migrate(db);
}

const ready = open();
const needKey = () => { if (!key) throw new Error('sem chave: banco bloqueado'); return key; };

const ops = {
  setKey: (k) => { key = k; return true; },
  dropKey: () => { key = null; return true; },
  info: () => ({
    sqlite: sqlite3.version.libVersion,
    schema: core.schemaVersion(db),
    count: core.count(db),
    sizeKB: Math.round(Number(db.selectValue('PRAGMA page_count')) * Number(db.selectValue('PRAGMA page_size')) / 1024),
    secureDelete: Number(db.selectValue('PRAGMA secure_delete')),
  }),
  async fill({ n, room, ttlMs, nowMs }) {
    const now = nowMs;
    const base = core.count(db);
    const msgs = Array.from({ length: n }, (_, i) => ({
      id: crypto.randomUUID(), room, expiresAt: now + ttlMs, acceptedAt: now + i,
      text: `mensagem ${base + i + 1} · ${'texto de exemplo '.repeat(4)}`,
    }));
    const t0 = performance.now();
    await core.putMessages(db, needKey(), msgs);
    return { inserted: n, ms: Math.round(performance.now() - t0) };
  },
  // `nowMs` vem de quem chama: no app real é o tempo confirmado pelo servidor
  // (§10), nunca o relógio local do worker.
  async list({ room, nowMs }) {
    if (!Number.isFinite(nowMs)) throw new Error('sem instante confiável: não lista');
    const t0 = performance.now();
    const r = await core.listRoom(db, needKey(), room, { nowMs, limit: 20 });
    return { ...r, ms: +(performance.now() - t0).toFixed(1) };
  },
  async wipe() {
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
