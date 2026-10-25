// Regressões da revisão: concorrência, falhas HTTP, uploads incertos e
// recuperação do lote usando o mesmo banco/identidade após fechar o app.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startApi, SETUP } from '../../../server/test/helpers.mjs';
import { loadCrypto } from '../../crypto/index.js';
import { TrustedClock } from '../../protocol/src/time.js';
import { CIRCLE_ROOM_ID } from '../../protocol/src/room.js';
import { MessengerClient, Api, MemoryStore } from '../src/index.js';

await loadCrypto(await readFile(new URL('../../crypto/pkg/mp_crypto_bg.wasm', import.meta.url)));
let api, ana, bia, caio, room;
const make = (store = new MemoryStore(), pickleKey = crypto.getRandomValues(new Uint8Array(32))) => new MessengerClient({ api: new Api(api.base, new TrustedClock()), store, pickleKey });
before(async () => {
  api = await startApi(8816);
  ana = make(); await ana.bootstrap(SETUP); await ana.login();
  for (const assign of [(c) => bia = c, (c) => caio = c]) {
    const { token } = await ana.api.post('/v1/invites', {}), c = make();
    await c.redeem(token); await c.login(); assign(c);
  }
  for (const c of [ana, bia, caio]) await c.refreshDirectory();
  room = (await ana.createRoom('direct', [bia.userId])).roomId;
  await bia.sync();
});
after(() => api?.stop());

test('R02: antes da aprovação só a administradora recebe o perfil do solicitante', async () => {
  assert.equal(bia.circleRoster(), null);
  await bia.sendInner(CIRCLE_ROOM_ID, 'nickname_change', { nickname: 'perfil privado', photo: null, about: null });
  assert.ok((await ana.sync()).received.some((m) => m.body?.nickname === 'perfil privado'));
  assert.equal((await caio.sync()).received.filter((m) => m.body?.nickname === 'perfil privado').length, 0);
  await assert.rejects(bia.sendStory(new Uint8Array([1]), { mime: 'image/jpeg', audience: [caio.userId] }), /confirmado/);
});

test('R03: chave exibida não pode verificar outra chave', async () => {
  const old = ana.known[bia.userId].curve;
  await assert.rejects(ana.setVerified(bia.userId, true, { curve: 'outra-chave', own: ana.account.curve25519Key }), /alterada/);
  assert.equal(ana.isVerified(bia.userId), false);
  await ana.setVerified(bia.userId, true, { curve: old, own: ana.account.curve25519Key });
  assert.equal(ana.isVerified(bia.userId), true);
});

test('R05: inserção/remoção concorrente preserva as outras entradas', async () => {
  const c = make();
  await Promise.all(Array.from({ length: 30 }, (_, i) => c.queue(room, { msgId: `entry${i}` }, null)));
  await Promise.all([c.dequeue('entry4'), c.queue(room, { msgId: 'lastentry' }, null), c.dequeue('entry9')]);
  const ids = (await c.outbox()).map((o) => o.payload.msgId);
  assert.equal(ids.length, 29); assert.equal(new Set(ids).size, 29);
  assert.ok(ids.includes('lastentry')); assert.ok(!ids.includes('entry4'));
});

test('R02: lista antiga não reverte aprovação e chave nova da administradora não herda confiança', async () => {
  await ana.confirmCircle([bia.userId, caio.userId]); await bia.sync(); await caio.sync();
  const confirmed = structuredClone(bia.trusted[CIRCLE_ROOM_ID]);
  await ana.sendInner(CIRCLE_ROOM_ID, 'membership', { members: [ana.userId, bia.userId], leader: ana.userId, revision: confirmed.revision });
  await bia.sync(); assert.deepEqual(bia.trusted[CIRCLE_ROOM_ID], confirmed);
  const old = bia.known[ana.userId].curve;
  try {
    bia.known[ana.userId].curve = Buffer.alloc(32, 17).toString('base64');
    assert.equal(bia.circleRoster(), null);
    await bia.applyMembership({ room: CIRCLE_ROOM_ID, sender: ana.userId, body: { members: [ana.userId, bia.userId], leader: ana.userId, revision: confirmed.revision + 1 } });
    assert.deepEqual(bia.trusted[CIRCLE_ROOM_ID], confirmed);
  } finally { bia.known[ana.userId].curve = old; }
});

test('R05: envios e sincronização concorrentes preservam o ratchet Olm', async () => {
  const sent = await Promise.all([ana.sendText(room, 'concorrente 1'), ana.sync(), ana.sendText(room, 'concorrente 2'), ana.sendText(room, 'concorrente 3')]);
  const r = await bia.sync();
  assert.deepEqual(r.rejected, []);
  const ids = sent.filter((m) => m.msgId).map((m) => m.msgId);
  assert.equal(r.received.filter((m) => ids.includes(m.msgId)).length, 3);
});

test('R06: 429/503 preservam o mesmo item e respeitam Retry-After; 400 é removível', async () => {
  for (const status of [429, 503, 400]) {
    let calls = 0;
    const c = make();
    c.api.post = async () => { calls++; throw Object.assign(new Error('injetado'), { status, code: 'injected', retryAfterMs: 20_000 }); };
    await c.queue(room, { msgId: `status${status}` }, null);
    await assert.rejects(c.deliver(room, `status${status}`));
    const item = (await c.outbox())[0];
    assert.equal(item.state, status === 400 ? 'failed' : 'ready');
    if (status !== 400) assert.ok(item.nextTryAt >= Date.now() + 19_000);
    await c.retryOutbox(); assert.equal(calls, 1, 'sync não martela falha nem antecipa o backoff');
    await c.cancelQueued(item.payload.msgId); assert.equal((await c.outbox()).length, 0);
  }
});

test('R09: cinco mídias duráveis antes do upload; offline + reinício preservam modos e conteúdo', async () => {
  const ids = [], originals = [];
  for (let i = 0; i < 5; i++) {
    const bytes = new Uint8Array(1000 + i).fill(i + 1); originals.push(bytes);
    ids.push(await ana.prepareMedia(room, bytes, { mode: i % 2 ? 'once' : 'media', mime: 'image/jpeg' }));
  }
  const realPost = ana.api.post.bind(ana.api);
  ana.api.post = async (path, ...args) => { if (path.includes('/media?')) throw new TypeError('offline'); return realPost(path, ...args); };
  try { await assert.rejects(ana.deliver(room, ids[0]), (e) => e.code === 'pending'); }
  finally { ana.api.post = realPost; }
  assert.equal((await ana.outbox()).filter((o) => ids.includes(o.payload.msgId)).length, 5);
  const reopened = make(ana.store, ana.pickleKey); await reopened.open(); await reopened.login(); await reopened.refreshDirectory();
  const retried = await reopened.retryOutbox({ force: true });
  assert.equal(retried.sent.filter((m) => ids.includes(m.msgId)).length, 5);
  assert.equal((await reopened.outbox()).length, 0);
  const got = (await bia.sync()).received.filter((m) => ids.includes(m.msgId));
  assert.equal(got.length, 5);
  for (let i = 0; i < 5; i++) {
    const m = got.find((m) => m.msgId === ids[i]);
    assert.equal(m.body.mode, i % 2 ? 'once' : 'media');
    assert.deepEqual(await bia.openMedia(m), originals[i]);
    assert.equal(await reopened.store.get(`upload:${ids[i]}:0`), null);
    if (i % 2) assert.equal((await reopened.store.getMessage(ids[i])).body.key, null);
  }
  ana = reopened;
});

test('R09: resposta perdida do upload reutiliza o objeto e o id da mensagem', async () => {
  const id = await ana.prepareMedia(room, new Uint8Array(1234).fill(9), { mime: 'image/jpeg' });
  const job = (await ana.outbox()).find((o) => o.payload.msgId === id), post = ana.api.post.bind(ana.api);
  let drop = true; const uploadIds = [];
  ana.api.post = async (path, ...args) => {
    const r = await post(path, ...args);
    if (path.includes('/media?')) { uploadIds.push(r.mediaId); if (drop) { drop = false; throw new TypeError('resposta perdida'); } }
    return r;
  };
  try {
    await assert.rejects(ana.deliver(room, id), (e) => e.code === 'pending');
    await ana.retryOutbox({ force: true });
  } finally { ana.api.post = post; }
  assert.deepEqual(uploadIds, [job.prepared.body.mediaId, job.prepared.body.mediaId]);
  assert.equal((await bia.sync()).received.filter((m) => m.msgId === id).length, 1);
});

test('R09: limpar conversa cancela o que ainda não foi transmitido e apaga os blocos', async () => {
  const id = await ana.prepareMedia(room, new Uint8Array([1, 2, 3]), { mode: 'once', mime: 'image/jpeg' });
  await ana.clearRoomForMe(room);
  assert.equal((await ana.outbox()).length, 0);
  assert.equal(await ana.store.get(`upload:${id}:0`), null);
  assert.equal((await bia.sync()).received.filter((m) => m.msgId === id).length, 0);
});

test('R09: vários blocos cifrados se recompõem sem mudar um byte', async () => {
  const bytes = new Uint8Array(400_000).map((_, i) => i % 251);
  const id = await ana.prepareMedia(room, bytes, { mime: 'image/jpeg' });
  assert.ok((await ana.outbox()).find((o) => o.payload.msgId === id).prepared.chunks > 1);
  await ana.deliver(room, id);
  const received = (await bia.sync()).received.find((m) => m.msgId === id);
  assert.deepEqual(await bia.openMedia(received), bytes);
});

test('R09: falha de disco durante cancelamento não perde a intenção de apagar nem conserva a CEK', async () => {
  const id = await ana.prepareMedia(room, new Uint8Array([1, 2]), { mode: 'once', mime: 'image/jpeg' });
  const put = ana.store.put.bind(ana.store);
  ana.store.put = async (k, v) => { if (k === `upload:${id}:0` && v === null) throw new Error('disco temporariamente indisponível'); return put(k, v); };
  try { await assert.rejects(ana.cancelQueued(id), /disco/); }
  finally { ana.store.put = put; }
  const saved = (await ana.outbox()).find((o) => o.payload.msgId === id);
  assert.equal(saved.state, 'cancelled'); assert.equal(saved.prepared.body.key, undefined);
  await ana.retryOutbox();
  assert.equal(await ana.store.get(`upload:${id}:0`), null); assert.equal((await ana.outbox()).length, 0);
});

test('R06/R09: falha terminal também vence, mesmo com Retry-After além do prazo', async () => {
  const id = await ana.prepareMedia(room, new Uint8Array([3, 4]), { mode: 'once', mime: 'image/jpeg' });
  await ana.updateQueued(id, { state: 'failed', at: Date.now() - MessengerClient.OUTBOX_TTL - 1, nextTryAt: Date.now() + MessengerClient.OUTBOX_TTL });
  await ana.retryOutbox();
  assert.equal((await ana.outbox()).length, 0); assert.equal(await ana.store.get(`upload:${id}:0`), null);
});

test('R09: sync não transmite lote pela metade e deliver reconhece o que sync já concluiu', async () => {
  const put = ana.store.put.bind(ana.store), post = ana.api.post.bind(ana.api);
  let enter, release, uploads = 0;
  const entered = new Promise((r) => enter = r), gate = new Promise((r) => release = r);
  ana.store.put = async (k, v) => { if (k.startsWith('upload:') && v && enter) { const notify = enter; enter = null; notify(); await gate; } return put(k, v); };
  ana.api.post = async (p, ...args) => { if (p.includes('/media?')) uploads++; return post(p, ...args); };
  let ids;
  try {
    const prepared = ana.prepareMediaBatch(room, Array.from({ length: 5 }, (_, i) => ({ bytes: new Uint8Array([i]), opts: { mode: i % 2 ? 'once' : 'media', mime: 'image/jpeg' } })));
    await entered;
    const syncing = ana.retryOutbox({ force: true });
    await Promise.resolve(); assert.equal(uploads, 0, 'primeiro bloco ainda não está pronto');
    assert.equal((await ana.outbox())[0].state, 'staging');
    release(); [ids] = await Promise.all([prepared, syncing]);
    assert.equal(uploads, 5);
    for (const id of ids) assert.equal((await ana.deliver(room, id)).msgId, id);
    assert.equal(uploads, 5, 'não sobe novamente o que sync já confirmou');
  } finally { release(); ana.store.put = put; ana.api.post = post; }
  assert.equal((await bia.sync()).received.filter((m) => ids.includes(m.msgId)).length, 5);
});

test('API antiga é recusada antes de subir mídia', async () => {
  const c = make(); let uploads = 0;
  const id = await c.prepareMedia(room, new Uint8Array([1]), { mime: 'image/jpeg' });
  c.api.get = async () => { throw Object.assign(new Error('not_found'), { status: 404 }); };
  c.api.post = async (p) => { if (p.includes('/media?')) uploads++; return { ok: true }; };
  await assert.rejects(c.deliver(room, id), /API precisa ser atualizada/);
  assert.equal(uploads, 0); assert.equal((await c.outbox())[0].state, 'failed');
  await c.cancelQueued(id);
});

test('R06: Api interpreta Retry-After em segundos e recusa valor inválido', async () => {
  for (const [header, expected] of [['20', 20_000], ['inválido', 0]]) {
    const api = new Api('https://api.invalid', new TrustedClock(), { fetchImpl: async () => new Response('{"error":"temporarily_unavailable"}', { status: 503, headers: { 'content-type': 'application/json', 'retry-after': header } }) });
    await assert.rejects(api.get('/v1/time'), (e) => e.status === 503 && e.retryAfterMs === expected);
  }
});
