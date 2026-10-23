// Núcleo do banco local cifrado (ADR 0010). Sem DOM, sem OPFS: recebe um
// `db` do SQLite (oo1) e uma CryptoKey AES-GCM não extraível. O mesmo código
// roda no Worker do navegador e no teste em Node.
//
// Cada mensagem é cifrada por registro. O AAD amarra id, conversa e prazo:
// trocar o prazo de uma linha no arquivo faz a decifragem falhar.

export const SCHEMA_VERSION = 2;
const enc = new TextEncoder();
const dec = new TextDecoder();

const MIGRATIONS = {
  1: (db) => {
    db.exec(`CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      room TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      iv BLOB NOT NULL,
      ct BLOB NOT NULL
    ) STRICT`);
    db.exec('CREATE INDEX messages_room ON messages(room, expires_at)');
  },
  // v2: ordem de exibição sem decifrar (instante de aceite do servidor).
  2: (db) => {
    db.exec('ALTER TABLE messages ADD COLUMN accepted_at INTEGER NOT NULL DEFAULT 0');
    db.exec('CREATE INDEX messages_order ON messages(room, accepted_at)');
  },
};

export function schemaVersion(db) {
  db.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) STRICT');
  return Number(db.selectValue("SELECT v FROM meta WHERE k = 'schema'") ?? 0);
}

// Cada passo roda numa transação. Se o app morrer no meio, o SQLite desfaz
// e o banco continua na versão anterior, íntegro (§F, §50.2).
export function migrate(db, { target = SCHEMA_VERSION, failAt = null } = {}) {
  let v = schemaVersion(db);
  if (v > target) throw new Error(`banco na versão ${v}, app conhece até ${target}: não fazer downgrade`);
  while (v < target) {
    const next = v + 1;
    db.transaction((tx) => {
      MIGRATIONS[next](tx);
      if (failAt === next) throw new Error(`falha simulada na migração ${next}`);
      tx.exec({ sql: "INSERT INTO meta(k, v) VALUES('schema', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", bind: [String(next)] });
    });
    v = next;
  }
  return v;
}

const aad = (id, room, expiresAt) => enc.encode(`mp/msg/v1/${id}/${room}/${expiresAt}`);

export async function encryptRecord(key, { id, room, expiresAt, text }) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(id, room, expiresAt) }, key, enc.encode(text)));
  return { id, room, expiresAt, iv, ct };
}

export function insertEncrypted(db, rows, acceptedAt = Date.now()) {
  db.transaction((tx) => {
    const st = tx.prepare('INSERT OR REPLACE INTO messages(id, room, expires_at, iv, ct, accepted_at) VALUES (?, ?, ?, ?, ?, ?)');
    try {
      for (const r of rows) st.bind([r.id, r.room, r.expiresAt, r.iv, r.ct, r.acceptedAt ?? acceptedAt]).stepReset();
    } finally { st.finalize(); }
  });
}

export async function putMessages(db, key, msgs) {
  const rows = [];
  for (const m of msgs) rows.push({ ...(await encryptRecord(key, m)), acceptedAt: m.acceptedAt });
  insertEncrypted(db, rows);
  return rows.length;
}

// Regra §25.6: apagar o que venceu ANTES de ler qualquer coisa.
export function purgeExpired(db, nowMs) {
  db.exec({ sql: 'DELETE FROM messages WHERE expires_at <= ?', bind: [nowMs] });
  return db.changes();
}

export async function listRoom(db, key, room, { nowMs, limit = 50 }) {
  const purged = purgeExpired(db, nowMs);
  const rows = db.selectObjects(
    'SELECT id, room, expires_at, iv, ct FROM messages WHERE room = ? AND expires_at > ? ORDER BY accepted_at DESC, id DESC LIMIT ?',
    [room, nowMs, limit]);
  const out = [];
  for (const r of rows) {
    try {
      const pt = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: r.iv, additionalData: aad(r.id, r.room, r.expires_at) }, key, r.ct);
      out.push({ id: r.id, expiresAt: r.expires_at, text: dec.decode(pt) });
    } catch {
      // Linha adulterada ou de outra chave: não mostra nada dela.
      out.push({ id: r.id, expiresAt: r.expires_at, text: null, error: 'integridade' });
    }
  }
  return { purged, messages: out };
}

export function deleteMessage(db, id) {
  db.exec({ sql: 'DELETE FROM messages WHERE id = ?', bind: [id] });
  return db.changes();
}

export function count(db) {
  return Number(db.selectValue('SELECT count(*) FROM messages'));
}
