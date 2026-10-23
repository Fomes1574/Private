// Durable Object por conversa. Guarda membros e política (regras de
// @mp/protocol), carimba o prazo no aceite e grava o fan-out no D1.
// O servidor nunca vê o conteúdo: só envelopes cifrados por destinatário.
import { DurableObject } from 'cloudflare:workers';
import { createRoom, apply, ttlFor, isMember, RoomError } from '../../packages/protocol/src/room.js';

const MAX_CT_B64 = 128 * 1024; // degrau máximo do envelope + sobra do Olm, em base64
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

const toJson = (s) => JSON.stringify({ ...s, members: [...s.members] });
const fromJson = (t) => { const o = JSON.parse(t); return { ...o, members: new Map(o.members) }; };

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS media (media_id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);`);
  }

  load() { const r = this.sql.exec('SELECT json FROM state').toArray()[0]; return r ? fromJson(r.json) : null; }
  save(s) { this.sql.exec('INSERT OR REPLACE INTO state(id, json) VALUES (1, ?)', toJson(s)); }

  view(s) {
    return {
      roomId: s.roomId, kind: s.kind, leader: s.leader, policyRev: s.policyRev, textTtl: s.textTtl, mediaTtl: s.mediaTtl,
      closed: s.closed, members: [...s.members].map(([userId, m]) => ({ userId, joinSeq: m.joinSeq, active: m.active })),
    };
  }

  async syncMembership(before, after) {
    const db = this.env.DB;
    const stmts = [];
    for (const [id, m] of after.members) {
      const was = before?.members.get(id)?.active;
      if (m.active && !was) stmts.push(db.prepare('INSERT OR IGNORE INTO room_members(user_id, room) VALUES (?, ?)').bind(id, after.roomId));
      if (!m.active && was) stmts.push(db.prepare('DELETE FROM room_members WHERE user_id = ? AND room = ?').bind(id, after.roomId));
    }
    if (stmts.length) await db.batch(stmts);
  }

  async init(actor, { roomId, kind, members, textTtl, mediaTtl }) {
    if (this.load()) return { error: 'exists' };
    let s;
    try { s = createRoom({ roomId, kind, creator: actor, members, textTtl, mediaTtl }); } catch (e) { return { error: 'bad_room', detail: e instanceof RoomError || e instanceof RangeError ? e.message : undefined }; }
    this.save(s);
    this.sql.exec('INSERT INTO events(at, actor, json) VALUES (?, ?, ?)', Date.now(), actor, JSON.stringify({ type: 'create', kind, members: [...s.members.keys()] }));
    await this.syncMembership(null, s);
    return this.view(s);
  }

  get(actor) {
    const s = this.load();
    if (!s) return { error: 'not_found' };
    if (!s.members.has(actor)) return { error: 'forbidden' };
    return this.view(s);
  }

  async event(actor, ev) {
    const s = this.load();
    if (!s) return { error: 'not_found' };
    let next;
    try { next = apply(s, { ...ev, actor }); } catch (e) {
      if (e instanceof RoomError || e instanceof RangeError) return { error: 'forbidden', detail: e.message };
      throw e;
    }
    this.save(next);
    this.sql.exec('INSERT INTO events(at, actor, json) VALUES (?, ?, ?)', Date.now(), actor, JSON.stringify(ev));
    await this.syncMembership(s, next);
    return this.view(next);
  }

  events(actor, after = 0) {
    const s = this.load();
    if (!s?.members.has(actor)) return { error: 'forbidden' };
    return this.sql.exec('SELECT seq, at, actor, json FROM events WHERE seq > ? ORDER BY seq LIMIT 200', after).toArray()
      .map((r) => ({ seq: r.seq, at: r.at, actor: r.actor, ...JSON.parse(r.json) }));
  }

  // Mídias desta conversa ainda válidas: quem sair perde os direitos pendentes.
  addMedia(actor, mediaId, expiresAt) {
    const s = this.load();
    if (!s || !isMember(s, actor)) return { error: 'forbidden' };
    this.sql.exec('DELETE FROM media WHERE expires_at <= ?', Date.now());
    this.sql.exec('INSERT OR IGNORE INTO media(media_id, expires_at) VALUES (?, ?)', mediaId, expiresAt);
    return { ok: true };
  }
  mediaIds() {
    this.sql.exec('DELETE FROM media WHERE expires_at <= ?', Date.now());
    return this.sql.exec('SELECT media_id FROM media').toArray().map((r) => r.media_id);
  }

  // Destinatários = membros ativos menos quem envia. O fan-out precisa cobrir
  // exatamente esse conjunto: nem a mais (vazaria para não membro), nem a menos.
  mediaPlan(actor, mode) {
    const s = this.load();
    if (!s) return { error: 'not_found' };
    if (!isMember(s, actor)) return { error: 'forbidden' };
    if (s.closed) return { error: 'gone' };
    return { recipients: this.recipients(s, actor), ttl: ttlFor(s, 'media'), roomId: s.roomId };
  }

  recipients(s, actor) {
    return [...s.members].filter(([id, m]) => m.active && id !== actor).map(([id]) => id).sort();
  }

  async send(actor, { msgId, kind, envelopes }) {
    const s = this.load();
    if (!s) return { error: 'not_found' };
    if (!isMember(s, actor)) return { error: 'forbidden' };
    if (s.closed) return { error: 'gone' };
    const to = this.recipients(s, actor);
    const given = Object.keys(envelopes || {}).sort();
    if (to.length === 0 || given.length !== to.length || given.some((id, i) => id !== to[i])) return { error: 'bad_recipients', expected: to };
    for (const ct of Object.values(envelopes)) {
      if (typeof ct !== 'string' || ct.length > MAX_CT_B64 || !B64_RE.test(ct)) return { error: 'bad_envelope' };
    }
    const db = this.env.DB;
    const existing = await db.prepare('SELECT sender, accepted_at, expires_at FROM messages WHERE room = ? AND msg_id = ?').bind(s.roomId, msgId).first();
    if (existing) {
      // Reenvio: mesmo prazo de antes, nunca um prazo "novo" (§11.7).
      if (existing.sender !== actor) return { error: 'conflict' };
      return { acceptedAt: existing.accepted_at, expiresAt: existing.expires_at, recipients: to, duplicate: true };
    }
    const acceptedAt = Date.now();
    const expiresAt = acceptedAt + ttlFor(s, kind === 'media' ? 'media' : 'text') * 1000;
    const stmts = [db.prepare('INSERT INTO messages(room, msg_id, sender, accepted_at, expires_at) VALUES (?, ?, ?, ?, ?)').bind(s.roomId, msgId, actor, acceptedAt, expiresAt)];
    for (const [rcpt, ct] of Object.entries(envelopes)) {
      const bytes = Uint8Array.from(atob(ct), (c) => c.charCodeAt(0));
      stmts.push(db.prepare('INSERT INTO envelopes(recipient, room, msg_id, accepted_at, expires_at, ct) VALUES (?, ?, ?, ?, ?, ?)').bind(rcpt, s.roomId, msgId, acceptedAt, expiresAt, bytes));
    }
    await db.batch(stmts); // tudo ou nada
    return { acceptedAt, expiresAt, recipients: to };
  }

  // Apagar para todos: só o autor (V7-010), ou o sistema quando o 4º documento
  // revoga o mais antigo (V6-020). Revoga entrega na hora e deixa tombstone.
  async deleteForAll(actor, msgId, { system = false } = {}) {
    const s = this.load();
    if (!s) return { error: 'not_found' };
    const db = this.env.DB;
    const m = await db.prepare('SELECT sender, expires_at FROM messages WHERE room = ? AND msg_id = ?').bind(s.roomId, msgId).first();
    if (!m) return { error: 'not_found' };
    if (!system && m.sender !== actor) return { error: 'forbidden' };
    const who = [...s.members].filter(([, x]) => x.active).map(([id]) => id);
    const stmts = [db.prepare('DELETE FROM envelopes WHERE room = ? AND msg_id = ?').bind(s.roomId, msgId)];
    for (const id of who) {
      stmts.push(db.prepare('INSERT OR IGNORE INTO tombstones(recipient, room, msg_id, expires_at) VALUES (?, ?, ?, ?)').bind(id, s.roomId, msgId, m.expires_at));
    }
    await db.batch(stmts);
    return { ok: true, recipients: who };
  }
}
