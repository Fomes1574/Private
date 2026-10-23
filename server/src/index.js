// Worker da API (Arquitetura A, ADR 0004). Toda decisão que precisa ser
// atômica fica num Durable Object; aqui só roteamento, autenticação e limites.
import { json, fail, readJson, HttpError, unwrap, randomId, assertId, sameBytes, SECURITY_HEADERS } from './http.js';
import { CHUNK } from './media.js';
import { MAX_DOC_BYTES, MAX_ACTIVE_DOCS } from '../../packages/protocol/src/documents.js';
import { CIRCLE_ROOM_ID } from '../../packages/protocol/src/room.js';

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

// O APK Android Capacitor 8 roda em https://localhost (androidScheme=https).
// É uma origem local de WebView, distinta do endereço público da PWA.
// Autorizamos APENAS estas duas origens; nunca usamos wildcard/reflexão irrestrita.
// CORS não substitui autenticação: sessões exigem token e assinatura do aparelho.
const ANDROID_APP_ORIGIN = 'https://localhost';
function cors(env, request) {
  const origin = request.headers.get('origin');
  if (!origin || (origin !== env.APP_ORIGIN && origin !== ANDROID_APP_ORIGIN)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-max-age': '600',
    // O app (outra origem) precisa ler o horário do servidor (relógio confiável).
    'access-control-expose-headers': 'x-mp-time',
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
// Quem silenciou a conversa recebe só o aviso pelo WebSocket, sem push.
async function nudge(env, ctx, userIds, { silent = [] } = {}) {
  if (!userIds?.length) return;
  const targets = await circle(env).pushTargetsByUser(userIds);
  ctx.waitUntil(Promise.all(userIds.map(async (u) => {
    const usable = (t) => (t.kind === 'fcm' ? !!env.FCM_SERVICE_ACCOUNT : !!env.VAPID_PRIVATE_JWK);
    const push = silent.includes(u) ? [] : (targets[u] ?? []).filter(usable);
    const r = await live(env, u).nudge(push).catch(() => null);
    if (r?.gone?.length) await circle(env).dropPushEndpoints(r.gone);
  })));
}

// Cota interna (§24): reserva atômica no D1 antes de guardar qualquer byte.
// Ao passar do limite, nega o upload (melhor que estourar a franquia).
const DEFAULT_QUOTA = 9 * 1024 ** 3; // abaixo dos 10 GB grátis do R2
async function reserveBytes(env, mediaId, bytes, expiresAt) {
  const limit = Number(env.MEDIA_QUOTA_BYTES) || DEFAULT_QUOTA;
  const now = Date.now();
  const r = await env.DB.prepare(`INSERT INTO media_usage(media_id, bytes, expires_at)
    SELECT ?1, ?2, ?3 WHERE (SELECT COALESCE(SUM(bytes), 0) FROM media_usage WHERE expires_at IS NULL OR expires_at > ?4) + ?2 <= ?5`)
    .bind(mediaId, bytes, expiresAt, now, limit).run();
  if (!r.meta.changes) throw new HttpError(507, 'storage_full');
}

const routes = [];
const PENDING_ROUTES = new Set(['/v1/vault/register', '/v1/devices/pair/commit', '/v1/me', '/v1/auth/logout']);
const route = (method, pattern, handler, { open = false } = {}) => routes.push({ method, re: new RegExp(`^${pattern}$`), handler, open });

// ---------- públicas ----------
route('GET', '/v1/time', async () => json(200, { now: Date.now() }), { open: true });

route('POST', '/v1/bootstrap', async ({ env, request }) => {
  const body = await readJson(request);
  // SETUP_CODE é um segredo de uso único criado pelo proprietário.
  if (!env.SETUP_CODE || env.SETUP_CODE.length < 16 || typeof body.setupCode !== 'string' || !sameBytes(body.setupCode, env.SETUP_CODE)) throw new HttpError(401, 'unauthorized');
  const r = unwrap(await circle(env).bootstrap({ device: body.device }));
  await room(env, CIRCLE_ROOM_ID).systemJoin(r.userId);
  return json(201, { ...r, circleRoom: CIRCLE_ROOM_ID });
}, { open: true });

route('POST', '/v1/invites/redeem', async ({ env, ctx, request }) => {
  const body = await readJson(request);
  const r = unwrap(await circle(env).redeem({ token: body.token, device: body.device }));
  await room(env, CIRCLE_ROOM_ID).systemJoin(r.userId);
  // Quem já está no círculo sincroniza e reanuncia o apelido para a pessoa nova.
  const view = await room(env, CIRCLE_ROOM_ID).get(r.userId);
  if (view?.members) await nudge(env, ctx, view.members.filter((m) => m.active && m.userId !== r.userId).map((m) => m.userId));
  return json(201, { ...r, circleRoom: CIRCLE_ROOM_ID });
}, { open: true });

route('POST', '/v1/auth/challenge', async ({ env, request }) => {
  const { deviceId } = await readJson(request);
  return json(200, await circle(env).challenge(assertId(deviceId)));
}, { open: true });

route('POST', '/v1/auth/session', async ({ env, request }) => {
  const b = await readJson(request);
  return json(200, unwrap(await circle(env).session({ deviceId: assertId(b.deviceId), nonce: String(b.nonce), signature: String(b.signature) })));
}, { open: true });

route('POST', '/v1/devices/pair/start', async ({ env, request }) => {
  const b = await readJson(request);
  const vault = b.vault ? { verifier: b.vault.verifier, deadDays: Number(b.vault.deadDays ?? 15) } : null;
  return json(201, unwrap(await circle(env).pairStart({ device: b.device, vault })));
}, { open: true });
route('POST', '/v1/devices/pair/status', async ({ env, request }) => {
  const b = await readJson(request);
  return json(200, await circle(env).pairStatus(assertId(b.pairingId), String(b.authPub)));
}, { open: true });

// ---------- autenticadas ----------
route('POST', '/v1/auth/logout', async ({ env, request }) => {
  await circle(env).logout(request.headers.get('authorization').slice(7));
  return json(200, { ok: true });
});
route('GET', '/v1/me', async ({ me }) => json(200, { userId: me.userId, deviceId: me.deviceId, isAdmin: me.isAdmin, pending: !!me.pending }));
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
route('POST', '/v1/devices/pair/commit', async ({ env, me }) => json(200, unwrap(await circle(env).pairCommit(me))));
route('POST', '/v1/me/guardian', async ({ env, request, me }) => json(200, unwrap(await circle(env).setGuardian(me, assertId((await readJson(request)).userId)))));
route('POST', '/v1/recovery/approve', async ({ env, request, me }) => json(200, unwrap(await circle(env).recoveryApprove(me, assertId((await readJson(request)).userId)))));
route('POST', '/v1/recovery/cancel', async ({ env, me }) => json(200, unwrap(await circle(env).recoveryCancel(me))));
route('POST', '/v1/admin/freeze', async ({ env, request, me }) => {
  const b = await readJson(request);
  return json(200, unwrap(await circle(env).freeze(me, assertId(b.userId), b.frozen !== false)));
});
route('POST', '/v1/admin/remove', async ({ env, ctx, request, me }) => {
  const userId = assertId((await readJson(request)).userId);
  unwrap(await circle(env).removeIdentity(me, userId));
  await purgeVisuals(env, await circle(env).visualClear(`u:${userId}`)); // foto de perfil some junto
  const { results } = await env.DB.prepare('SELECT room FROM room_members WHERE user_id = ?').bind(userId).all();
  for (const { room: rid } of results) {
    const r = room(env, rid);
    await r.systemRemove(userId);
    ctx.waitUntil(r.mediaIds().then((ids) => Promise.all(ids.map((id) => media(env, id).revokeMember(userId)))));
  }
  return json(200, { ok: true, rooms: results.length });
});
route('GET', '/v1/security-events', async ({ env, url }) => json(200, { events: await circle(env).securityEvents(Number(url.searchParams.get('after')) || 0) }));
route('GET', '/v1/push/key', async ({ env }) => json(200, { key: env.VAPID_PUBLIC ?? null }));
route('POST', '/v1/push', async ({ env, request, me }) => {
  const b = await readJson(request, 8192);
  return json(200, unwrap(await circle(env).setPush(me.deviceId, { endpoint: b.endpoint ?? null, fcm: b.fcm ?? null })));
});

// Conversas
route('POST', '/v1/rooms', async ({ env, request, me }) => {
  const b = await readJson(request);
  const members = Array.isArray(b.members) ? b.members.map((m) => assertId(m)) : [];
  if (!(await circle(env).activeUsers([me.userId, ...members]))) throw new HttpError(400, 'bad_members');
  const roomId = randomId(16); // conversa nova sempre com id novo (V7-008)
  return json(201, unwrap(await room(env, roomId).init(me.userId, { roomId, kind: b.kind, members, textTtl: b.textTtl, mediaTtl: b.mediaTtl })));
});
route('GET', '/v1/rooms', async ({ env, me }) => {
  const { results } = await env.DB.prepare('SELECT room FROM room_members WHERE user_id = ?').bind(me.userId).all();
  return json(200, { rooms: results.map((r) => r.room) });
});
route('GET', '/v1/rooms/([A-Za-z0-9_-]{8,64})', async ({ env, me, p }) => json(200, unwrap(await room(env, p[1]).get(me.userId))));
route('GET', '/v1/rooms/([A-Za-z0-9_-]{8,64})/events', async ({ env, me, p, url }) => json(200, { events: unwrap(await room(env, p[1]).events(me.userId, Number(url.searchParams.get('after')) || 0)) }));
route('POST', '/v1/rooms/([A-Za-z0-9_-]{8,64})/events', async ({ env, ctx, request, me, p }) => {
  const ev = await readJson(request);
  const r = room(env, p[1]);
  const view = unwrap(await r.event(me.userId, ev));
  // Grupo encerrado: foto e fundo do grupo deixam de existir (§21).
  if (view.closed) ctx.waitUntil(circle(env).visualClear(`r:${p[1]}`).then((ids) => purgeVisuals(env, ids)));
  // Saiu ou foi removido: perde os direitos de mídia pendentes (§15.7).
  const gone = ev.type === 'leave' ? me.userId : ev.type === 'remove_member' ? ev.member : null;
  if (gone) ctx.waitUntil(Promise.all((await r.mediaIds()).map((id) => media(env, id).revokeMember(gone))));
  await nudge(env, ctx, view.members.filter((m) => m.active && m.userId !== me.userId).map((m) => m.userId));
  return json(200, view);
});
route('POST', '/v1/rooms/([A-Za-z0-9_-]{8,64})/mute', async ({ env, request, me, p }) => json(200, unwrap(await room(env, p[1]).setMute(me.userId, Number((await readJson(request)).until)))));
route('POST', '/v1/rooms/([A-Za-z0-9_-]{8,64})/messages', async ({ env, ctx, request, me, p }) => {
  const b = await readJson(request, 2 * 1024 * 1024);
  const kind = ['media', 'story'].includes(b.kind) ? b.kind : 'text';
  const r = unwrap(await room(env, p[1]).send(me.userId, { msgId: assertId(b.msgId), kind, envelopes: b.envelopes, ttl: b.ttl === undefined ? undefined : Number(b.ttl) }));
  await nudge(env, ctx, r.recipients, { silent: r.silent });
  return json(r.duplicate ? 200 : 201, { acceptedAt: r.acceptedAt, expiresAt: r.expiresAt });
});
route('POST', '/v1/rooms/([A-Za-z0-9_-]{8,64})/messages/([A-Za-z0-9_-]{8,64})/delete', async ({ env, ctx, me, p }) => {
  const r = unwrap(await room(env, p[1]).deleteForAll(me.userId, p[2]));
  await quota(env, me.userId).release(p[2]); // se era documento, a vaga volta (§16)
  await nudge(env, ctx, r.recipients.filter((u) => u !== me.userId));
  return json(200, { ok: true });
});

// Caixa de entrada: envelopes válidos + tombstones + horário do servidor.
route('GET', '/v1/sync', async ({ env, me }) => {
  const now = Date.now();
  const [env_, tomb, rooms] = await env.DB.batch([
    env.DB.prepare('SELECT room, msg_id AS msgId, sender, accepted_at AS acceptedAt, expires_at AS expiresAt, ct FROM envelopes WHERE recipient = ? AND expires_at > ? ORDER BY accepted_at, msg_id LIMIT 201').bind(me.userId, now),
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
  // Story: audiência e prazo vêm na URL e são conferidos pela conversa.
  const story = url.searchParams.get('story') === '1'
    ? { audience: (url.searchParams.get('audience') || '').split(',').filter(Boolean).slice(0, 10).map(assertId), ttl: url.searchParams.has('ttl') ? Number(url.searchParams.get('ttl')) : undefined }
    : null;
  const plan = unwrap(await room(env, p[1]).mediaPlan(me.userId, mode, story));
  const mediaId = randomId(16);
  const box = media(env, mediaId);
  const expiresAt = Date.now() + plan.ttl * 1000;
  await reserveBytes(env, mediaId, len, expiresAt);
  const created = await box.create({ mediaId, mode, room: p[1], sender: me.userId, recipients: plan.recipients, expiresAt, backend: env.BLOB_BACKEND, key: `m/${mediaId}` });
  if (created.error) { await env.DB.prepare('DELETE FROM media_usage WHERE media_id = ?').bind(mediaId).run(); unwrap(created); }
  let count = 0, size = 0;
  try {
  if (env.BLOB_BACKEND === 'r2') {
    const obj = await env.MEDIA.put(`m/${mediaId}`, request.body);
    size = obj.size;
  } else {
    // Lê em fluxo e manda pedaços de 1,9 MB: memória do Worker fica pequena.
    let buf = new Uint8Array(CHUNK), fill = 0;
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      let off = 0;
      while (off < value.byteLength) {
        const n = Math.min(CHUNK - fill, value.byteLength - off);
        buf.set(value.subarray(off, off + n), fill);
        fill += n; off += n; size += n;
        if (size > len) throw new HttpError(400, 'bad_length');
        if (fill === CHUNK) { unwrap(await box.putChunk(count++, buf)); buf = new Uint8Array(CHUNK); fill = 0; }
      }
    }
    if (fill) unwrap(await box.putChunk(count++, buf.subarray(0, fill)));
  }
  if (size !== len) throw new HttpError(400, 'bad_length');
  } catch (e) {
    // Upload incompleto não fica guardado esperando o prazo: apaga já.
    await box.revokeAll(me.userId).catch(() => null);
    throw e;
  }
  unwrap(await box.seal({ count, size }));
  await room(env, p[1]).addMedia(me.userId, mediaId, expiresAt);
  return json(201, { mediaId, expiresAt });
});
route('POST', '/v1/media/([A-Za-z0-9_-]{8,64})/open', async ({ env, ctx, me, p }) => {
  const box = media(env, p[1]);
  const r = unwrap(await box.open(me.userId));
  const headers = { 'content-type': 'application/octet-stream', 'content-length': String(r.size), ...SECURITY_HEADERS };
  if (r.backend === 'r2') {
    const obj = await env.MEDIA.get(r.key);
    if (!obj) throw new HttpError(404, 'gone');
    const [a, b] = obj.body.tee();
    if (r.last) ctx.waitUntil(new Response(b).arrayBuffer().then(() => box.purgeIfDone()));
    else b.cancel();
    return new Response(a, { headers });
  }
  // Entrega pedaço por pedaço; o último consumo apaga ao terminar.
  let i = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      if (i >= r.count) {
        controller.close();
        if (r.last) ctx.waitUntil(box.purgeIfDone());
        return;
      }
      controller.enqueue(new Uint8Array(await box.readChunk(i++)));
    },
  });
  return new Response(stream, { headers });
});
route('POST', '/v1/media/([A-Za-z0-9_-]{8,64})/revoke', async ({ env, me, p }) => {
  const r = unwrap(await media(env, p[1]).revokeAll(me.userId)); // só o autor (conferido no DO)
  await quota(env, me.userId).release(p[1]);
  return json(200, r);
});

// Foto de perfil, foto e fundo de grupo (§21, V6-024): cifrados no
// aparelho, sem prazo, só a versão atual existe; trocar ou remover apaga a
// anterior na hora. A chave só vai cifrada (anúncio no círculo ou perfil do
// grupo, da líder).
const MAX_VISUAL_BYTES = 2 * 1024 * 1024;
const VISUAL_SLOTS = { user: ['profile'], room: ['photo', 'background'] };
async function visualOwner(env, me, scope, id, slot) {
  if (!VISUAL_SLOTS[scope].includes(slot)) throw new HttpError(400, 'bad_slot');
  if (scope === 'user') {
    if (id !== me.userId) throw new HttpError(403, 'forbidden');
    return `u:${id}`;
  }
  const v = unwrap(await room(env, id).get(me.userId));
  if (v.kind !== 'group' || v.leader !== me.userId || v.closed) throw new HttpError(403, 'forbidden');
  return `r:${id}`;
}
async function purgeVisuals(env, ids) {
  for (const id of ids) if (id) await media(env, id).revokeAll(null, { system: true }).catch(() => null);
}
route('POST', '/v1/visual/(user|room)/([A-Za-z0-9_-]{8,64})/(profile|photo|background)', async ({ env, request, me, p, url }) => {
  const owner = await visualOwner(env, me, p[1], p[2], p[3]);
  if (url.searchParams.get('remove') === '1') {
    const { old } = await circle(env).visualSwap(owner, p[3], null);
    await purgeVisuals(env, [old]);
    return json(200, { ok: true });
  }
  const len = Number(request.headers.get('content-length'));
  if (!(len > 0 && len <= MAX_VISUAL_BYTES)) throw new HttpError(413, 'too_large');
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength !== len) throw new HttpError(400, 'bad_length');
  const mediaId = randomId(16);
  const box = media(env, mediaId);
  // No R2 com prefixo próprio (v/): a regra de 16 dias do bucket só vale
  // para a mídia temporária (m/), não para a foto atual.
  const key = `v/${mediaId}`;
  await reserveBytes(env, mediaId, len, null);
  unwrap(await box.create({ mediaId, mode: 'visual', room: owner, sender: me.userId, recipients: [], expiresAt: null, backend: env.BLOB_BACKEND, slot: p[3], key }));
  let count = 0;
  try {
    if (env.BLOB_BACKEND === 'r2') await env.MEDIA.put(key, bytes);
    else for (let off = 0; off < bytes.byteLength; off += CHUNK) unwrap(await box.putChunk(count++, bytes.subarray(off, off + CHUNK)));
  } catch (e) { await box.revokeAll(null, { system: true }).catch(() => null); throw e; }
  unwrap(await box.seal({ count, size: bytes.byteLength }));
  // Só depois de o novo estar completo a referência troca; o antigo some.
  const { old } = await circle(env).visualSwap(owner, p[3], mediaId);
  await purgeVisuals(env, [old]);
  return json(201, { mediaId });
});
route('GET', '/v1/visual/([A-Za-z0-9_-]{8,64})', async ({ env, me, p }) => {
  const box = media(env, p[1]);
  const d = await box.describe();
  if (d.error || d.mode !== 'visual' || d.state !== 'active') throw new HttpError(404, 'gone');
  // Versão antiga nunca é entregue, mesmo que a limpeza tenha falhado.
  if ((await circle(env).visualCurrent(d.room, d.slot)) !== p[1]) throw new HttpError(404, 'gone');
  if (d.room.startsWith('r:')) {
    const v = unwrap(await room(env, d.room.slice(2)).get(me.userId));
    if (!v.members.some((m) => m.userId === me.userId && m.active)) throw new HttpError(403, 'forbidden');
  }
  let out;
  if (d.backend === 'r2') {
    const obj = await env.MEDIA.get(d.key);
    if (!obj) throw new HttpError(404, 'gone');
    out = new Uint8Array(await obj.arrayBuffer());
  } else {
    out = new Uint8Array(d.size);
    for (let i = 0, off = 0; i < d.count; i++) { const c = new Uint8Array(await box.readChunk(i)); out.set(c, off); off += c.byteLength; }
  }
  return new Response(out, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(d.size), ...SECURITY_HEADERS } });
});

// Parte do servidor na chave do aparelho (ADR 0014).
route('POST', '/v1/vault/register', async ({ env, request, me }) => {
  const b = await readJson(request);
  return json(201, unwrap(await circle(env).vaultRegister(me, { verifier: b.verifier, duress: b.duress ?? null, deadDays: Number(b.deadDays ?? 15) })));
});
// Aberta (o app ainda está trancado): quem conta os erros é o servidor.
route('POST', '/v1/vault/release', async ({ env, request }) => {
  const b = await readJson(request);
  const r = await circle(env).vaultRelease({ vaultId: b.vaultId, verifier: b.verifier });
  if (r.error === 'wrong_secret') return json(403, { error: 'wrong_secret', left: r.left });
  return json(200, unwrap(r));
}, { open: true });
route('POST', '/v1/vault/settings', async ({ env, request, me }) => {
  const b = await readJson(request);
  return json(200, unwrap(await circle(env).vaultSettings(me, { vaultId: b.vaultId, ...(b.deadDays !== undefined ? { deadDays: Number(b.deadDays) } : {}), ...(b.duress !== undefined ? { duress: b.duress } : {}) })));
});
route('POST', '/v1/vault/kill-code', async ({ env, request, me }) => json(200, unwrap(await circle(env).setKillCode(me, { codeHash: (await readJson(request)).codeHash }))));
route('POST', '/v1/vault/kill', async ({ env, request }) => json(200, unwrap(await circle(env).useKillCode({ code: (await readJson(request)).code }))), { open: true });

route('GET', '/v1/docs/mine', async ({ env, me }) => json(200, { active: await quota(env, me.userId).active(), max: MAX_ACTIVE_DOCS }));

// Documento publicado: cota global de 3 por pessoa (V6-019, V6-020).
route('POST', '/v1/docs/publish', async ({ env, ctx, request, me }) => {
  const b = await readJson(request);
  const mediaId = assertId(b.mediaId), msgId = assertId(b.msgId);
  // Tudo conferido no servidor: o documento é meu, é documento, está na
  // conversa da mensagem, e a mensagem também é minha.
  const info = unwrap(await media(env, mediaId).describe());
  if (info.mode !== 'doc' || info.sender !== me.userId || info.state !== 'active') throw new HttpError(403, 'forbidden');
  if ((await room(env, info.room).messageOwner(msgId)) !== me.userId) throw new HttpError(403, 'forbidden');
  const doc = { docId: mediaId, room: info.room, msgId, size: info.size, expiresAt: info.expiresAt };
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
        if (!who || who.pending) throw new HttpError(401, 'unauthorized');
        return live(env, who.userId).fetch(request);
      }
      const r = routes.find((x) => x.method === request.method && x.re.test(url.pathname));
      if (!r) throw new HttpError(404, 'not_found');
      const me = r.open ? null : await auth(env, request);
      // Aparelho novo ainda pendente (troca em duas fases): só guarda o cofre
      // e confirma. Nada de mensagens, diretório ou mídia antes disso.
      if (me?.pending && !PENDING_ROUTES.has(url.pathname)) throw new HttpError(403, 'pending_device');
      // Limite de tráfego por pessoa (§8): escritas em rajada viram 429.
      if (me && request.method === 'POST' && env.WRITE_LIMIT && !(await env.WRITE_LIMIT.limit({ key: me.userId })).success) throw new HttpError(429, 'rate_limited');
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
      env.DB.prepare('DELETE FROM media_usage WHERE expires_at IS NOT NULL AND expires_at <= ?').bind(now),
    ]);
    await circle(env).prune(); // inclui o interruptor do homem morto dos cofres
  },
};
