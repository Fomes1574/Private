// Worker da API (Arquitetura A, ADR 0004). Toda decisão que precisa ser
// atômica fica num Durable Object; aqui só roteamento, autenticação e limites.
import { json, fail, readJson, HttpError, unwrap, randomId, assertId, SECURITY_HEADERS } from './http.js';
import { CHUNK } from './media.js';
import { MAX_DOC_BYTES } from '../../packages/protocol/src/documents.js';

export { Circle } from './circle.js';
export { Room } from './room.js';
export { MediaBox } from './media.js';
export { DocQuota } from './docs.js';
export { Live } from './live.js';

const MAX_MEDIA_BYTES = 100 * 1024 * 1024; // vídeo de 5 min comprimido (Prova 6); ajustar após medir (P-13)

const circle = (env) => env.CIRCLE.get(env.CIRCLE.idFromName('circle'));
const room = (env, id) => env.ROOM.get(env.ROOM.idFromName(id));
const media = (env, id) => env.MEDIA_BOX.get(env.MEDIA_BOX.idFromName(id));
const quota = (env, userId) => env.DOC_QUOTA.get(env.DOC_QUOTA.idFromName(userId));
const live = (env, userId) => env.LIVE.get(env.LIVE.idFromName(userId));

function cors(env, request) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== env.APP_ORIGIN) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '600',
    vary: 'origin',
  };
}

async function auth(env, request) {
  const m = /^Bearer ([A-Za-z0-9_-]{40,})$/.exec(request.headers.get('authorization') || '');
  const who = m ? await circle(env).authenticate(m[1]) : null;
  if (!who) throw new HttpError(401, 'unauthorized');
  return who;
}

// Aviso "sincronize" para quem recebeu algo (sem conteúdo, sem remetente).
async function nudge(env, ctx, userIds) {
  if (!userIds?.length) return;
  const targets = await circle(env).pushTargetsByUser(userIds);
  ctx.waitUntil(Promise.all(userIds.map(async (u) => {
    const r = await live(env, u).nudge(env.VAPID_PRIVATE_JWK ? targets[u] ?? [] : []).catch(() => null);
    if (r?.gone?.length) await circle(env).dropPushEndpoints(r.gone);
  })));
}

const routes = [];
const route = (method, pattern, handler, { open = false } = {}) => routes.push({ method, re: new RegExp(`^${pattern}$`), handler, open });

// ---------- públicas ----------
route('GET', '/v1/time', async () => json(200, { now: Date.now() }), { open: true });

route('POST', '/v1/bootstrap', async ({ env, request }) => {
  const body = await readJson(request);
  // SETUP_CODE é um segredo de uso único criado pelo proprietário.
  if (!env.SETUP_CODE || env.SETUP_CODE.length < 16 || body.setupCode !== env.SETUP_CODE) throw new HttpError(401, 'unauthorized');
  return json(201, unwrap(await circle(env).bootstrap({ device: body.device })));
}, { open: true });

route('POST', '/v1/invites/redeem', async ({ env, request }) => {
  const body = await readJson(request);
  return json(201, unwrap(await circle(env).redeem({ token: body.token, device: body.device })));
}, { open: true });

route('POST', '/v1/auth/challenge', async ({ env, request }) => {
  const { deviceId } = await readJson(request);
  return json(200, await circle(env).challenge(assertId(deviceId)));
}, { open: true });

route('POST', '/v1/auth/session', async ({ env, request }) => {
  const b = await readJson(request);
  return json(200, unwrap(await circle(env).session({ deviceId: assertId(b.deviceId), nonce: String(b.nonce), signature: String(b.signature) })));
}, { open: true });

route('POST', '/v1/devices/pair/start', async ({ env, request }) => json(201, unwrap(await circle(env).pairStart({ device: (await readJson(request)).device }))), { open: true });
route('POST', '/v1/devices/pair/status', async ({ env, request }) => {
  const b = await readJson(request);
  return json(200, await circle(env).pairStatus(assertId(b.pairingId), String(b.authPub)));
}, { open: true });

// ---------- autenticadas ----------
route('POST', '/v1/auth/logout', async ({ env, request }) => {
  await circle(env).logout(request.headers.get('authorization').slice(7));
  return json(200, { ok: true });
});
route('GET', '/v1/directory', async ({ env }) => json(200, { members: await circle(env).directory() }));
route('POST', '/v1/keys', async ({ env, request, me }) => json(200, await circle(env).uploadKeys(me.deviceId, await readJson(request))));
route('POST', '/v1/keys/claim', async ({ env, request }) => json(200, unwrap(await circle(env).claimKey(assertId((await readJson(request)).userId)))));
route('POST', '/v1/invites', async ({ env, request, me }) => {
  const b = await readJson(request);
  return json(201, unwrap(await circle(env).createInvite(me.userId, { kind: b.kind === 'recovery' ? 'recovery' : 'join', forUser: b.forUser ?? null })));
});
route('POST', '/v1/devices/pair/approve', async ({ env, request, me }) => {
  const b = await readJson(request);
  return json(200, unwrap(await circle(env).pairApprove(me, { pairingId: assertId(b.pairingId), code: String(b.code) })));
});
route('POST', '/v1/me/guardian', async ({ env, request, me }) => json(200, unwrap(await circle(env).setGuardian(me, assertId((await readJson(request)).userId)))));
route('POST', '/v1/recovery/approve', async ({ env, request, me }) => json(200, unwrap(await circle(env).recoveryApprove(me, assertId((await readJson(request)).userId)))));
route('POST', '/v1/recovery/cancel', async ({ env, me }) => json(200, unwrap(await circle(env).recoveryCancel(me))));
route('POST', '/v1/admin/freeze', async ({ env, request, me }) => {
  const b = await readJson(request);
  return json(200, unwrap(await circle(env).freeze(me, assertId(b.userId), b.frozen !== false)));
});
route('POST', '/v1/admin/remove', async ({ env, request, me }) => json(200, unwrap(await circle(env).removeIdentity(me, assertId((await readJson(request)).userId)))));
route('GET', '/v1/security-events', async ({ env, url }) => json(200, { events: await circle(env).securityEvents(Number(url.searchParams.get('after')) || 0) }));
route('GET', '/v1/push/key', async ({ env }) => json(200, { key: env.VAPID_PUBLIC ?? null }));
route('POST', '/v1/push', async ({ env, request, me }) => json(200, unwrap(await circle(env).setPush(me.deviceId, (await readJson(request)).endpoint ?? null))));

// Conversas
route('POST', '/v1/rooms', async ({ env, request, me }) => {
  const b = await readJson(request);
  const members = Array.isArray(b.members) ? b.members.map((m) => assertId(m)) : [];
  if (!(await circle(env).activeUsers([me.userId, ...members]))) throw new HttpError(400, 'bad_members');
  const roomId = randomId(16); // conversa nova sempre com id novo (V7-008)
  return json(201, unwrap(await room(env, roomId).init(me.userId, { roomId, kind: b.kind, members, textTtl: b.textTtl, mediaTtl: b.mediaTtl })));
});
route('GET', '/v1/rooms/([A-Za-z0-9_-]{8,64})', async ({ env, me, p }) => json(200, unwrap(await room(env, p[1]).get(me.userId))));
route('GET', '/v1/rooms/([A-Za-z0-9_-]{8,64})/events', async ({ env, me, p, url }) => json(200, { events: unwrap(await room(env, p[1]).events(me.userId, Number(url.searchParams.get('after')) || 0)) }));
route('POST', '/v1/rooms/([A-Za-z0-9_-]{8,64})/events', async ({ env, ctx, request, me, p }) => {
  const ev = await readJson(request);
  const r = room(env, p[1]);
  const view = unwrap(await r.event(me.userId, ev));
  // Saiu ou foi removido: perde os direitos de mídia pendentes (§15.7).
  const gone = ev.type === 'leave' ? me.userId : ev.type === 'remove_member' ? ev.member : null;
  if (gone) ctx.waitUntil(Promise.all((await r.mediaIds()).map((id) => media(env, id).revokeMember(gone))));
  await nudge(env, ctx, view.members.filter((m) => m.active && m.userId !== me.userId).map((m) => m.userId));
  return json(200, view);
});
route('POST', '/v1/rooms/([A-Za-z0-9_-]{8,64})/messages', async ({ env, ctx, request, me, p }) => {
  const b = await readJson(request, 2 * 1024 * 1024);
  const r = unwrap(await room(env, p[1]).send(me.userId, { msgId: assertId(b.msgId), kind: b.kind === 'media' ? 'media' : 'text', envelopes: b.envelopes }));
  await nudge(env, ctx, r.recipients);
  return json(r.duplicate ? 200 : 201, { acceptedAt: r.acceptedAt, expiresAt: r.expiresAt });
});
route('POST', '/v1/rooms/([A-Za-z0-9_-]{8,64})/messages/([A-Za-z0-9_-]{8,64})/delete', async ({ env, ctx, me, p }) => {
  const r = unwrap(await room(env, p[1]).deleteForAll(me.userId, p[2]));
  await nudge(env, ctx, r.recipients.filter((u) => u !== me.userId));
  return json(200, { ok: true });
});

// Caixa de entrada: envelopes válidos + tombstones + horário do servidor.
route('GET', '/v1/sync', async ({ env, me }) => {
  const now = Date.now();
  const [env_, tomb, rooms] = await env.DB.batch([
    env.DB.prepare('SELECT room, msg_id AS msgId, accepted_at AS acceptedAt, expires_at AS expiresAt, ct FROM envelopes WHERE recipient = ? AND expires_at > ? ORDER BY accepted_at, msg_id LIMIT 201').bind(me.userId, now),
    env.DB.prepare('SELECT room, msg_id AS msgId FROM tombstones WHERE recipient = ? LIMIT 500').bind(me.userId),
    env.DB.prepare('SELECT room FROM room_members WHERE user_id = ?').bind(me.userId),
  ]);
  const items = env_.results.slice(0, 200).map((e) => ({ ...e, ct: btoa(String.fromCharCode(...new Uint8Array(e.ct))) }));
  return json(200, { now, tombstones: tomb.results, envelopes: items, more: env_.results.length > 200, rooms: rooms.results.map((r) => r.room) });
});
route('POST', '/v1/ack', async ({ env, request, me }) => {
  const b = await readJson(request, 256 * 1024);
  const stmts = [];
  for (const [rm, id] of (b.envelopes || []).slice(0, 500)) stmts.push(env.DB.prepare('DELETE FROM envelopes WHERE recipient = ? AND room = ? AND msg_id = ?').bind(me.userId, assertId(rm), assertId(id)));
  for (const [rm, id] of (b.tombstones || []).slice(0, 500)) stmts.push(env.DB.prepare('DELETE FROM tombstones WHERE recipient = ? AND room = ? AND msg_id = ?').bind(me.userId, assertId(rm), assertId(id)));
  if (stmts.length) await env.DB.batch(stmts);
  return json(200, { ok: true, count: stmts.length });
});

// Mídia
route('POST', '/v1/rooms/([A-Za-z0-9_-]{8,64})/media', async ({ env, request, me, p, url }) => {
  const mode = ['once', 'media', 'doc'].includes(url.searchParams.get('mode')) ? url.searchParams.get('mode') : null;
  if (!mode) throw new HttpError(400, 'bad_mode');
  const len = Number(request.headers.get('content-length'));
  const max = mode === 'doc' ? MAX_DOC_BYTES + 64 * 1024 : MAX_MEDIA_BYTES;
  if (!(len > 0 && len <= max)) throw new HttpError(413, 'too_large');
  const plan = unwrap(await room(env, p[1]).mediaPlan(me.userId, mode));
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength !== len) throw new HttpError(400, 'bad_length');
  const mediaId = randomId(16);
  const box = media(env, mediaId);
  const expiresAt = Date.now() + plan.ttl * 1000;
  unwrap(await box.create({ mediaId, mode, room: p[1], sender: me.userId, recipients: plan.recipients, expiresAt, backend: env.BLOB_BACKEND }));
  let count = 0;
  if (env.BLOB_BACKEND === 'r2') await env.MEDIA.put(`m/${mediaId}`, body);
  else for (let off = 0; off < body.byteLength; off += CHUNK) unwrap(await box.putChunk(count++, body.subarray(off, off + CHUNK)));
  unwrap(await box.seal({ count, size: body.byteLength }));
  await room(env, p[1]).addMedia(me.userId, mediaId, expiresAt);
  return json(201, { mediaId, expiresAt });
});
route('POST', '/v1/media/([A-Za-z0-9_-]{8,64})/open', async ({ env, me, p }) => {
  const box = media(env, p[1]);
  const r = unwrap(await box.open(me.userId));
  let bytes;
  if (r.backend === 'r2') {
    const obj = await env.MEDIA.get(`m/${r.mediaId}`);
    if (!obj) throw new HttpError(404, 'gone');
    bytes = new Uint8Array(await obj.arrayBuffer());
  } else {
    bytes = new Uint8Array(r.size);
    for (let i = 0, off = 0; i < r.count; i++) { const c = new Uint8Array(await box.readChunk(i)); bytes.set(c, off); off += c.byteLength; }
  }
  if (r.last) await box.purgeIfDone();
  return new Response(bytes, { headers: { 'content-type': 'application/octet-stream', ...SECURITY_HEADERS } });
});
route('POST', '/v1/media/([A-Za-z0-9_-]{8,64})/revoke', async ({ env, me, p }) => json(200, unwrap(await media(env, p[1]).revokeAll(me.userId))));

// Documento publicado: cota global de 3 por pessoa (V6-019, V6-020).
route('POST', '/v1/docs/publish', async ({ env, ctx, request, me }) => {
  const b = await readJson(request);
  const doc = { docId: assertId(b.mediaId), room: assertId(b.room), msgId: assertId(b.msgId), size: Number(b.size), expiresAt: Number(b.expiresAt) };
  const r = unwrap(await quota(env, me.userId).publish(me.userId, doc));
  // Limpeza física depois da transição lógica: mídia e tombstone para todos.
  for (const ev of r.evicted) {
    await media(env, ev.docId).revokeAll(me.userId, { system: true }).catch(() => null);
    const del = await room(env, ev.room).deleteForAll(me.userId, ev.msgId, { system: true }).catch(() => null);
    if (del?.recipients) await nudge(env, ctx, del.recipients.filter((u) => u !== me.userId));
  }
  return json(200, { evicted: r.evicted.map((e) => e.docId), active: r.active });
});

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const corsHeaders = cors(env, request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    let res;
    try {
      // Tempo real: o token vai no subprotocolo, não na URL (não fica em log).
      if (url.pathname === '/v1/live') {
        if (request.headers.get('upgrade') !== 'websocket') throw new HttpError(426, 'upgrade_required');
        const protos = (request.headers.get('sec-websocket-protocol') || '').split(',').map((s) => s.trim());
        if (protos[0] !== 'mp-v1' || !protos[1]) throw new HttpError(401, 'unauthorized');
        const who = await circle(env).authenticate(protos[1]);
        if (!who) throw new HttpError(401, 'unauthorized');
        return live(env, who.userId).fetch(request);
      }
      const r = routes.find((x) => x.method === request.method && x.re.test(url.pathname));
      if (!r) throw new HttpError(404, 'not_found');
      const me = r.open ? null : await auth(env, request);
      res = await r.handler({ env, ctx, request, url, me, p: r.re.exec(url.pathname) });
    } catch (e) {
      if (e instanceof HttpError) res = fail(e.status, e.code);
      else { console.error('erro interno', e?.name); res = fail(500, 'internal'); }
    }
    const h = new Headers(res.headers);
    for (const [k, v] of Object.entries(corsHeaders)) h.set(k, v);
    h.set('x-mp-time', String(Date.now())); // relógio confiável do cliente
    return new Response(res.body, { status: res.status, headers: h });
  },

  // Limpeza periódica: o filtro por prazo já impede a entrega; isto apaga os bytes.
  async scheduled(_event, env) {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM envelopes WHERE expires_at <= ?').bind(now),
      env.DB.prepare('DELETE FROM tombstones WHERE expires_at <= ?').bind(now),
      env.DB.prepare('DELETE FROM messages WHERE expires_at <= ?').bind(now),
    ]);
  },
};
