// Prova 5 · ver uma vez com consumo atômico (§15, §25.3, ADR 0004).
//
// Um Durable Object por mídia. Ele guarda, para cada destinatário, um direito
// pending → consumed | revoked, o prazo absoluto e (no modo "do") os pedaços
// cifrados. O servidor nunca recebe a chave da mídia.
import { DurableObject } from 'cloudflare:workers';

const HOUR = 3600;
const MIN_TTL = 12 * HOUR; // §10: 12 horas a 15 dias
const MAX_TTL = 15 * 24 * HOUR;
const MAX_BYTES = 25 * 1024 * 1024;
const CHUNK = 1_900_000; // abaixo do limite de 2 MB por linha do SQLite do DO
const MAX_RECIPIENTS = 9; // círculo de 10 pessoas
const ID_RE = /^[a-z0-9-]{1,36}$/;

// ---------- utilidades HTTP ----------
const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...SECURITY_HEADERS } });
// Erros com código fixo: nunca ecoam a entrada (ADR 0008).
const fail = (status, code) => json(status, { error: code });

// ---------- autenticação da prova ----------
// Token = base64url(JSON{m, exp}) + "." + base64url(HMAC-SHA256).
// O servidor real usa chave do aparelho com desafio (ver server/); aqui o
// objetivo é só ter identidades distintas e não forjáveis no teste.
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function hmacKey(env) {
  if (!env.TOKEN_SECRET || env.TOKEN_SECRET.length < 32) throw new Error('TOKEN_SECRET ausente');
  return crypto.subtle.importKey('raw', new TextEncoder().encode(env.TOKEN_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function issueToken(env, member, ttlSec = 3600) {
  const payload = new TextEncoder().encode(JSON.stringify({ m: member, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env), payload);
  return `${b64u(payload)}.${b64u(sig)}`;
}

async function authMember(env, request) {
  const h = request.headers.get('authorization') || '';
  const m = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(h);
  if (!m) return null;
  const payload = unb64u(m[1]);
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(env), unb64u(m[2]), payload);
  if (!ok) return null;
  const { m: member, exp } = JSON.parse(new TextDecoder().decode(payload));
  if (!ID_RE.test(member) || exp < Date.now() / 1000) return null;
  return member;
}

// ---------- Worker ----------
const box = (env, mediaId) => env.MEDIA_BOX.get(env.MEDIA_BOX.idFromName(mediaId));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && url.pathname === '/v1/dev/token') {
        // Só existe na prova, com DEV_TOKENS=1. O app real não tem esta rota.
        if (env.DEV_TOKENS !== '1') return fail(404, 'not_found');
        const { member } = await request.json();
        if (!ID_RE.test(member || '')) return fail(400, 'bad_member');
        return json(200, { token: await issueToken(env, member) });
      }

      const me = await authMember(env, request);
      if (!me) return fail(401, 'unauthorized');

      if (request.method === 'POST' && url.pathname === '/v1/media') return upload(request, env, url, me);

      const m = /^\/v1\/media\/([0-9a-f-]{36})\/(open|revoke|remove)$/.exec(url.pathname);
      if (request.method === 'POST' && m) {
        const [, mediaId, action] = m;
        const stub = box(env, mediaId);
        if (action === 'open') return open(env, stub, mediaId, me);
        if (action === 'revoke') return result(await stub.revokeAll(me));
        if (action === 'remove') {
          const { member } = await request.json();
          return result(await stub.revokeMember(me, member));
        }
      }
      return fail(404, 'not_found');
    } catch (e) {
      // Só o tipo do erro, sem dados da requisição.
      console.error('erro interno', e?.name);
      return fail(500, 'internal');
    }
  },
};

const STATUS = { forbidden: 403, used: 410, revoked: 410, expired: 410, gone: 404, not_ready: 409, exists: 409, bad_state: 409 };
const result = (r) => (r.error ? fail(STATUS[r.error] ?? 400, r.error) : json(200, r));

async function upload(request, env, url, me) {
  const ttl = Number(url.searchParams.get('ttl'));
  // Só na prova, com DEV_TOKENS=1, o teste pode encurtar o mínimo para ver o
  // vencimento acontecer. Em produção vale sempre 12 h.
  const minTtl = env.DEV_TOKENS === '1' && env.DEV_MIN_TTL ? Number(env.DEV_MIN_TTL) : MIN_TTL;
  if (!Number.isInteger(ttl) || ttl < minTtl || ttl > MAX_TTL) return fail(400, 'bad_ttl');
  const to = (url.searchParams.get('to') || '').split(',').filter(Boolean);
  if (to.length < 1 || to.length > MAX_RECIPIENTS || new Set(to).size !== to.length || !to.every((x) => ID_RE.test(x)) || to.includes(me)) {
    return fail(400, 'bad_recipients');
  }
  const len = Number(request.headers.get('content-length'));
  if (!(len > 0 && len <= MAX_BYTES)) return fail(413, 'too_large');
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength !== len) return fail(400, 'bad_length');

  const mediaId = crypto.randomUUID();
  const stub = box(env, mediaId);
  const now = Date.now();
  const created = await stub.create({ mediaId, sender: me, recipients: to, expiresAt: now + ttl * 1000, backend: env.BLOB_BACKEND });
  if (created.error) return result(created);
  let count = 0;
  if (env.BLOB_BACKEND === 'r2') {
    await env.MEDIA.put(`m/${mediaId}`, body);
  } else {
    for (let off = 0; off < body.byteLength; off += CHUNK) await stub.putChunk(count++, body.subarray(off, off + CHUNK));
  }
  await stub.seal({ count, size: body.byteLength });
  // Prazo vem do servidor (§10): devolve o instante para o remetente gravar.
  return json(201, { mediaId, acceptedAt: now, expiresAt: now + ttl * 1000 });
}

async function open(env, stub, mediaId, me) {
  const r = await stub.consume(me);
  if (r.error) return result(r);
  // O direito já foi consumido. Se a conexão cair daqui em diante, a
  // visualização é perdida: escolha conservadora aceita em §15.3.
  let bytes;
  if (r.backend === 'r2') {
    const obj = await env.MEDIA.get(`m/${mediaId}`);
    if (!obj) return fail(404, 'gone');
    bytes = new Uint8Array(await obj.arrayBuffer());
  } else {
    bytes = new Uint8Array(r.size);
    for (let i = 0, off = 0; i < r.count; i++) {
      const c = new Uint8Array(await stub.readChunk(i));
      bytes.set(c, off);
      off += c.byteLength;
    }
  }
  if (r.last) await stub.purgeIfDone();
  return new Response(bytes, { headers: { 'content-type': 'application/octet-stream', ...SECURITY_HEADERS } });
}

// ---------- Durable Object ----------
export class MediaBox extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.ensure();
  }

  // Recria as tabelas depois de um deleteAll() na mesma instância.
  ensure() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rights (member TEXT PRIMARY KEY, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chunks (i INTEGER PRIMARY KEY, data BLOB NOT NULL);`);
  }

  meta() {
    this.ensure();
    const out = {};
    for (const r of this.sql.exec('SELECT k, v FROM meta')) out[r.k] = JSON.parse(r.v);
    return out;
  }
  setMeta(obj) {
    for (const [k, v] of Object.entries(obj)) this.sql.exec('INSERT INTO meta(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, JSON.stringify(v));
  }
  pending() { return this.sql.exec("SELECT count(*) AS n FROM rights WHERE state = 'pending'").one().n; }

  async create({ mediaId, sender, recipients, expiresAt, backend }) {
    if (this.meta().state) return { error: 'exists' };
    // Lista de destinatários congelada no envio (§15.1).
    this.setMeta({ state: 'uploading', mediaId, sender, expiresAt, backend });
    for (const m of recipients) this.sql.exec("INSERT INTO rights(member, state) VALUES(?, 'pending')", m);
    await this.ctx.storage.setAlarm(expiresAt);
    return { ok: true };
  }

  putChunk(i, data) {
    if (this.meta().state !== 'uploading') return { error: 'bad_state' };
    this.sql.exec('INSERT OR REPLACE INTO chunks(i, data) VALUES(?, ?)', i, data);
    return { ok: true };
  }

  seal({ count, size }) {
    if (this.meta().state !== 'uploading') return { error: 'bad_state' };
    this.setMeta({ state: 'active', count, size });
    return { ok: true };
  }

  // Coração da prova. Nada de await entre ler e gravar o direito: o Durable
  // Object processa uma chamada por vez, então dois pedidos simultâneos do
  // mesmo destinatário não conseguem os dois ver "pending".
  async consume(member) {
    const meta = this.meta();
    if (!meta.state) return { error: 'gone' };
    if (meta.state !== 'active') return { error: 'not_ready' };
    if (Date.now() >= meta.expiresAt) { await this.purge('expired'); return { error: 'expired' }; }
    if (member === meta.sender) return { error: 'forbidden' }; // remetente não reabre (§15.6)
    const row = this.sql.exec('SELECT state FROM rights WHERE member = ?', member).toArray()[0];
    if (!row) return { error: 'forbidden' };
    if (row.state !== 'pending') return { error: row.state === 'consumed' ? 'used' : 'revoked' };
    this.sql.exec("UPDATE rights SET state = 'consumed' WHERE member = ?", member);
    return { ok: true, backend: meta.backend, count: meta.count, size: meta.size, last: this.pending() === 0 };
  }

  readChunk(i) {
    return this.sql.exec('SELECT data FROM chunks WHERE i = ?', i).one().data;
  }

  async purgeIfDone() {
    if (this.pending() === 0) await this.purge('all_consumed');
    return { ok: true };
  }

  // "Apagar para todos": só o autor (V7-010).
  async revokeAll(member) {
    const meta = this.meta();
    if (!meta.state) return { error: 'gone' };
    if (member !== meta.sender) return { error: 'forbidden' };
    this.sql.exec("UPDATE rights SET state = 'revoked' WHERE state = 'pending'");
    await this.purge('deleted_for_all');
    return { ok: true };
  }

  // Membro removido perde o direito e deixa de segurar a limpeza (§15.7).
  async revokeMember(member, target) {
    const meta = this.meta();
    if (!meta.state) return { error: 'gone' };
    if (member !== meta.sender) return { error: 'forbidden' };
    this.sql.exec("UPDATE rights SET state = 'revoked' WHERE member = ? AND state = 'pending'", target);
    if (this.pending() === 0) await this.purge('all_consumed');
    return { ok: true };
  }

  async purge(reason) {
    const meta = this.meta();
    if (meta.backend === 'r2' && this.env.MEDIA) {
      await this.env.MEDIA.delete(`m/${meta.mediaId}`);
    }
    await this.ctx.storage.deleteAlarm();
    // Apaga tudo: direitos, pedaços e metadados. Pedidos futuros veem "gone".
    await this.ctx.storage.deleteAll();
    return reason;
  }

  async alarm() {
    await this.purge('expired');
  }
}
