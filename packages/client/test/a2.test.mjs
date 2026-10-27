// Entrega A2 no núcleo do cliente: avisos guardados (S1), verificação e pausa
// de mídia (S8), círculo confirmado pela administradora (S3) e conferência
// de edição/reação (F09, D7).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startApi, SETUP } from '../../../server/test/helpers.mjs';
import { loadCrypto } from '../../crypto/index.js';
import { TrustedClock } from '../../protocol/src/time.js';
import { CIRCLE_ROOM_ID } from '../../protocol/src/room.js';
import { MessengerClient, Api, MemoryStore } from '../src/index.js';

await loadCrypto(await readFile(new URL('../../crypto/pkg/mp_crypto_bg.wasm', import.meta.url)));

let api;
const p = {};
const testFetch = async (url, opts) => {
  try { return await fetch(url, opts); } catch (e) {
    if (opts?.method !== 'GET' || e.cause?.code !== 'UND_ERR_SOCKET') throw e;
    return fetch(url, opts);
  }
};
const newClient = (store = new MemoryStore(), pickleKey = crypto.getRandomValues(new Uint8Array(32))) =>
  new MessengerClient({ api: new Api(api.base, new TrustedClock(), { fetchImpl: testFetch }), store, pickleKey });
const randomB64 = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');

// Troca de aparelho em duas fases: devolve o cliente novo da mesma pessoa.
async function newDeviceFor(old) {
  const novo = newClient();
  const dev = await novo.createDevice();
  const { token: permit } = await old.api.post('/v1/devices/pair/permit');
  const start = await novo.api.post('/v1/devices/pair/start', { device: dev, permit });
  const ok = await old.api.post('/v1/devices/pair/approve', { pairingId: start.pairingId, code: start.code });
  Object.assign(novo, { userId: ok.userId, deviceId: ok.deviceId });
  await novo.saveDevice(); await novo.login();
  await novo.api.post('/v1/vault/register', { verifier: randomB64(), deadDays: 15 });
  await novo.api.post('/v1/devices/pair/commit');
  await novo.refreshDirectory();
  return novo;
}

before(async () => {
  api = await startApi(8799);
  p.ana = newClient();
  await p.ana.bootstrap(SETUP); await p.ana.login();
  for (const n of ['bia', 'caio']) {
    const { token } = await p.ana.api.post('/v1/invites', {});
    p[n] = newClient();
    await p[n].redeem(token); await p[n].login();
  }
  for (const c of Object.values(p)) { await c.refreshDirectory(); await c.circleAdminId(); }
});
after(() => api?.stop());

test('S3: a administradora é a primeira identidade, fixada no aparelho', async () => {
  for (const c of Object.values(p)) assert.equal(await c.circleAdminId(), p.ana.userId);
  await assert.rejects(p.bia.confirmCircle([p.bia.userId]), /só a administradora/);
});

test('S3: só quem a administradora confirmou recebe o que vai pelo círculo', async () => {
  await p.ana.confirmCircle([p.bia.userId]);
  await p.bia.sync(); await p.caio.sync();
  assert.deepEqual(p.bia.circleRoster().sort(), [p.ana.userId, p.bia.userId].sort());
  await p.bia.sendInner(CIRCLE_ROOM_ID, 'nickname_change', { nickname: 'Bia', photo: null, about: null });
  const toAna = await p.ana.sync();
  assert.ok(toAna.received.some((m) => m.kind === 'nickname_change' && m.body.nickname === 'Bia'));
  const toCaio = await p.caio.sync();
  assert.equal(toCaio.received.filter((m) => m.kind === 'nickname_change').length, 0, 'não confirmado não recebe o apelido');
  assert.ok(p.bia.warnings.some((w) => w.kind === 'unconfirmed_circle' && w.userIds.includes(p.caio.userId)));
  await assert.rejects(p.bia.sendStory(new Uint8Array(10), { mime: 'image/jpeg', audience: [p.caio.userId] }), /administradora/);
  // Lista de outra pessoa que não a administradora: ignorada.
  p.caio.trusted[CIRCLE_ROOM_ID] = { members: [p.caio.userId, p.ana.userId, p.bia.userId], leader: p.caio.userId };
  await p.caio.sendInner(CIRCLE_ROOM_ID, 'membership', { members: [p.caio.userId, p.ana.userId, p.bia.userId], leader: p.caio.userId });
  await p.bia.sync();
  assert.ok(!p.bia.circleRoster().includes(p.caio.userId));
  assert.ok(p.bia.warnings.some((w) => w.kind === 'membership_rejected'));
  // Confirmado: passa a receber.
  await p.ana.confirmCircle([p.bia.userId, p.caio.userId]);
  await p.bia.sync(); await p.caio.sync();
  await p.bia.sendInner(CIRCLE_ROOM_ID, 'nickname_change', { nickname: 'Bia', photo: null, about: null });
  assert.ok((await p.caio.sync()).received.some((m) => m.kind === 'nickname_change'));
});

test('S1: avisos de segurança ficam guardados e voltam ao reabrir o app', async () => {
  const store = p.ana.store, key = p.ana.pickleKey;
  assert.ok(p.ana.warnings.length >= 0);
  p.ana.warn({ kind: 'key_changed', userId: p.bia.userId, at: Date.now() });
  await p.ana.saveWarnings();
  const again = newClient(store, key);
  await again.open();
  assert.ok(again.warnings.some((w) => w.kind === 'key_changed' && w.userId === p.bia.userId));
});

test('S8: contato verificado que troca de chave pausa a mídia até conferir de novo', async () => {
  const d = await p.ana.createRoom('direct', [p.bia.userId]);
  await p.bia.sync();
  await p.ana.setVerified(p.bia.userId, true);
  assert.equal(p.ana.isVerified(p.bia.userId), true);
  p.bia = await newDeviceFor(p.bia);
  await p.ana.refreshDirectory();
  assert.ok(p.ana.warnings.some((w) => w.kind === 'key_changed' && w.userId === p.bia.userId && w.verified));
  assert.equal(p.ana.keyChangedSinceVerified(p.bia.userId), true);
  await assert.rejects(p.ana.sendMedia(d.roomId, new Uint8Array(50), { mime: 'image/jpeg' }), (e) => e.code === 'key_unverified');
  await p.ana.sendText(d.roomId, 'texto continua indo'); // só a mídia pausa
  await p.ana.setVerified(p.bia.userId, false); // aceitou a chave nova
  await p.ana.sendMedia(d.roomId, new Uint8Array(50), { mime: 'image/jpeg' });
  const r = await p.bia.sync();
  assert.ok(r.received.some((m) => m.kind === 'media'));
});

test('F09: edição vinda de outra conversa é ignorada; D7: editar só texto próprio', async () => {
  const a = await p.ana.createRoom('group', [p.bia.userId, p.caio.userId]);
  const b = await p.ana.createRoom('group', [p.bia.userId, p.caio.userId]);
  await p.bia.sync(); await p.caio.sync();
  const m = await p.bia.sendText(a.roomId, 'original');
  await p.caio.sync();
  // Bia manda uma "edição" da mensagem da sala A pela sala B.
  await p.bia.sendInner(b.roomId, 'edit', { target: m.msgId, text: 'adulterada', version: 1 });
  await p.caio.sync();
  assert.equal((await p.caio.store.getMessage(m.msgId)).text, 'original');
  await assert.rejects(p.caio.edit(a.roomId, m.msgId, 'x'), /só o autor/);
  await p.bia.edit(a.roomId, m.msgId, 'corrigida');
  await p.caio.sync();
  assert.equal((await p.caio.store.getMessage(m.msgId)).text, 'corrigida');
});
