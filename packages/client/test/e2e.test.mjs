// Três pessoas usando o núcleo do cliente contra o servidor local real.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startApi, SETUP, d1 } from '../../../server/test/helpers.mjs';
import { loadCrypto } from '../../crypto/index.js';
import { TrustedClock } from '../../protocol/src/time.js';
import { MessengerClient, Api, MemoryStore } from '../src/index.js';

await loadCrypto(await readFile(new URL('../../crypto/pkg/mp_crypto_bg.wasm', import.meta.url)));

let api;
const p = {};
const newClient = (store = new MemoryStore(), pickleKey = crypto.getRandomValues(new Uint8Array(32))) =>
  new MessengerClient({ api: new Api(api.base, new TrustedClock()), store, pickleKey });

before(async () => { api = await startApi(8794); });
after(() => api?.stop());

let room;
test('entrada: administradora, convites, sessão por chave do aparelho', async () => {
  p.ana = newClient();
  await p.ana.bootstrap(SETUP); await p.ana.login();
  for (const n of ['bia', 'caio']) {
    const { token } = await p.ana.api.post('/v1/invites', {});
    p[n] = newClient();
    await p[n].redeem(token); await p[n].login();
  }
  for (const c of Object.values(p)) await c.refreshDirectory();
  room = (await p.ana.createRoom('group', [p.bia.userId, p.caio.userId], { textTtl: 86400, mediaTtl: 86400 })).roomId;
});

test('texto cifrado chega a todos e o servidor nunca vê o conteúdo', async () => {
  const sent = await p.ana.sendText(room, 'segredo da ana 🌙');
  for (const n of ['bia', 'caio']) {
    const r = await p[n].sync();
    assert.deepEqual(r.rejected, []);
    assert.equal(r.received[0].body.text, 'segredo da ana 🌙');
    const v = await p[n].view(room);
    assert.equal(v.render[0].text, 'segredo da ana 🌙');
    assert.equal(v.render[0].expiresAt, sent.expiresAt, 'prazo do servidor');
  }
  const dump = d1(api.persist, 'SELECT hex(ct) AS h FROM envelopes UNION ALL SELECT msg_id FROM messages');
  assert.ok(!dump.includes(Buffer.from('segredo').toString('hex').toUpperCase()), 'texto não aparece em claro no D1');
});

test('conversa nos dois sentidos, resposta, reação e edição', async () => {
  const m = await p.bia.sendText(room, 'oi, ana', { replyTo: (await p.bia.view(room)).render[0].msgId });
  await p.ana.sync(); await p.caio.sync();
  const got = (await p.ana.view(room)).render.find((x) => x.msgId === m.msgId);
  assert.equal(got.text, 'oi, ana');
  assert.ok(got.replyTo);
  await p.ana.react(room, m.msgId, '👍');
  await p.bia.sync();
  assert.equal((await p.bia.store.getMessage(m.msgId)).reactions[p.ana.userId], '👍');
  await p.bia.edit(room, m.msgId, 'oi, ana!!');
  await p.ana.sync();
  const ed = await p.ana.store.getMessage(m.msgId);
  assert.deepEqual([ed.text, ed.edited, ed.expiresAt], ['oi, ana!!', true, m.expiresAt], 'editado mantém o prazo');
});

test('mensagem falsificada (remetente trocado por dentro) é descartada', async () => {
  // Caio cifra uma mensagem dizendo ser da Ana: o servidor autentica Caio.
  const { encodeInner } = await import('../../protocol/src/envelope.js');
  const { sealOuter } = await import('../../crypto/index.js');
  const msgId = 'falsoFalsoFalso01';
  const inner = encodeInner({ v: 1, kind: 'text', msgId, room, sender: p.ana.userId, policyRev: 1, body: { text: 'sou a ana, juro' } });
  const envs = {};
  for (const u of [p.ana.userId, p.bia.userId]) envs[u] = sealOuter(await p.caio.sessionFor(u), inner);
  await p.caio.persistCrypto();
  await p.caio.api.post(`/v1/rooms/${room}/messages`, { msgId, kind: 'text', envelopes: envs });
  const r = await p.bia.sync();
  assert.equal(r.received.length, 0);
  assert.match(r.rejected[0].reason, /não conferem/);
  assert.ok(!(await p.bia.store.getMessage(msgId)));
});

test('apagar para todos: some antes de aparecer, inclusive para quem estava offline', async () => {
  const m = await p.ana.sendText(room, 'vou apagar');
  await p.bia.sync(); // bia recebeu; caio ficou "offline"
  await p.ana.deleteForAll(room, m.msgId);
  await p.bia.sync(); await p.caio.sync();
  for (const n of ['bia', 'caio']) assert.ok(!(await p[n].view(room)).render.some((x) => x.msgId === m.msgId), n);
  await assert.rejects(p.bia.deleteForAll(room, (await p.bia.view(room)).render.find((x) => x.sender === p.ana.userId).msgId), /403/, 'só o autor');
});

test('apagar para mim não afeta os outros', async () => {
  const m = await p.ana.sendText(room, 'só some pra mim');
  await p.bia.sync(); await p.caio.sync();
  await p.bia.deleteForMe(m.msgId);
  assert.ok(!(await p.bia.view(room)).render.some((x) => x.msgId === m.msgId));
  assert.ok((await p.caio.view(room)).render.some((x) => x.msgId === m.msgId));
});

test('sem tempo confiável nada aparece; vencida some antes de aparecer', async () => {
  const caioView = await p.caio.view(room);
  assert.ok(caioView.render.length > 0);
  p.caio.api.clock.invalidate();
  assert.equal((await p.caio.view(room)).blocked, true);
  await p.caio.api.get('/v1/time'); // volta a ter tempo do servidor
  const any = caioView.render[0];
  await p.caio.store.putMessage({ ...any, expiresAt: Date.now() - 1 });
  assert.ok(!(await p.caio.view(room)).render.some((x) => x.msgId === any.msgId));
  assert.ok(!(await p.caio.store.getMessage(any.msgId)), 'vencida destruída no aparelho');
});

test('mídia cifrada em segmentos; ver uma vez pelo cliente', async () => {
  const photo = new Uint8Array(200_000);
  for (let i = 0; i < photo.length; i += 65536) crypto.getRandomValues(photo.subarray(i, i + 65536));
  const m = await p.ana.sendMedia(room, photo, { mode: 'once', mime: 'image/jpeg' });
  await p.bia.sync(); await p.caio.sync();
  const bm = await p.bia.store.getMessage(m.msgId);
  assert.deepEqual(await p.bia.openMedia(bm), photo);
  await assert.rejects(p.bia.openMedia(bm), /410/, 'segunda vez não');
  await assert.rejects(p.ana.openMedia(m), /403/, 'quem enviou não reabre');
  assert.deepEqual(await p.caio.openMedia(await p.caio.store.getMessage(m.msgId)), photo);
});

test('fechar e reabrir o app: mesma identidade e sessões continuam', async () => {
  const store = p.bia.store, key = p.bia.pickleKey;
  const again = newClient(store, key);
  await again.open(); await again.login();
  assert.equal(again.userId, p.bia.userId);
  await p.ana.sendText(room, 'depois de reabrir');
  const r = await again.sync();
  assert.equal(r.received.at(-1).body.text, 'depois de reabrir');
  p.bia = again;
});

test('troca de chave de alguém vira aviso de segurança', async () => {
  // Caio troca de aparelho (QR): chaves novas.
  const novo = newClient();
  const dev = await novo.createDevice();
  const start = await novo.api.post('/v1/devices/pair/start', { device: dev });
  const ok = await p.caio.api.post('/v1/devices/pair/approve', { pairingId: start.pairingId, code: start.code });
  Object.assign(novo, { userId: ok.userId, deviceId: ok.deviceId });
  await novo.saveDevice(); await novo.login(); await novo.refreshDirectory();
  await p.ana.refreshDirectory();
  assert.ok(p.ana.warnings.some((w) => w.kind === 'key_changed' && w.userId === novo.userId));
  await p.ana.sendText(room, 'para o aparelho novo');
  const r = await novo.sync();
  assert.ok(r.received.some((x) => x.body.text === 'para o aparelho novo'), 'sessão nova com a chave nova');
  p.caio = novo;
});
