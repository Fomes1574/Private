// Entregas C e D no núcleo: fila de envio sem duplicar (F10), mídia órfã
// revogada (F11), tamanho em degraus (S7), enquete e voto, fixar mensagem,
// favoritas e áudio de ver uma vez (b.7).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startApi, SETUP } from '../../../server/test/helpers.mjs';
import { loadCrypto } from '../../crypto/index.js';
import { TrustedClock } from '../../protocol/src/time.js';
import { MessengerClient, Api, MemoryStore } from '../src/index.js';

await loadCrypto(await readFile(new URL('../../crypto/pkg/mp_crypto_bg.wasm', import.meta.url)));

let api, room;
const p = {};
const testFetch = async (url, opts) => {
  try { return await fetch(url, opts); } catch (e) {
    if (opts?.method !== 'GET' || e.cause?.code !== 'UND_ERR_SOCKET') throw e;
    return fetch(url, opts);
  }
};
// Rede que pode "cair" na volta: o pedido chega ao servidor, a resposta não.
let dropNextReply = false;
const flakyFetch = async (url, opts) => {
  const r = await testFetch(url, opts);
  if (dropNextReply && /\/messages$/.test(new URL(url).pathname)) { dropNextReply = false; throw new TypeError('fetch failed'); }
  return r;
};
const newClient = (f = testFetch) => new MessengerClient({ api: new Api(api.base, new TrustedClock(), { fetchImpl: f }), store: new MemoryStore(), pickleKey: crypto.getRandomValues(new Uint8Array(32)) });

before(async () => {
  api = await startApi(8800);
  p.ana = newClient(flakyFetch);
  await p.ana.bootstrap(SETUP); await p.ana.login();
  for (const n of ['bia', 'caio']) {
    const { token } = await p.ana.api.post('/v1/invites', {});
    p[n] = newClient();
    await p[n].redeem(token); await p[n].login();
  }
  for (const c of Object.values(p)) await c.refreshDirectory();
  room = (await p.ana.createRoom('group', [p.bia.userId, p.caio.userId])).roomId;
  await p.bia.sync(); await p.caio.sync();
});
after(() => api?.stop());

test('F10: resposta perdida não duplica; a fila reenvia o mesmo id', async () => {
  dropNextReply = true;
  const err = await p.ana.sendText(room, 'chegou uma vez só').catch((e) => e);
  assert.equal(err.code, 'pending');
  assert.equal((await p.ana.outbox()).length, 1, 'ficou na fila');
  await p.ana.sync(); // a rede voltou: a fila vai junto
  assert.equal((await p.ana.outbox()).length, 0);
  const got = (await p.bia.sync()).received.filter((m) => m.body?.text === 'chegou uma vez só');
  assert.equal(got.length, 1, 'uma mensagem só');
  assert.ok(await p.ana.store.getMessage(err.msgId), 'o remetente guardou com o horário do servidor');
});

test('F11: envio recusado depois do upload revoga a mídia', async () => {
  const realInner = p.ana.sendInner.bind(p.ana);
  let mediaId;
  p.ana.sendInner = async (r, k, body) => { mediaId = body.mediaId; const e = new Error('400 bad_recipients'); e.status = 400; throw e; };
  await assert.rejects(p.ana.sendMedia(room, new Uint8Array(500), { mime: 'image/jpeg' }));
  p.ana.sendInner = realInner;
  await assert.rejects(p.bia.api.post(`/v1/media/${mediaId}/open`, undefined, { binary: true }), /404/);
});

test('S7: foto sobe em degrau de tamanho e abre igual', async () => {
  const photo = new Uint8Array(12_345).map((_, i) => i % 251);
  const m = await p.ana.sendMedia(room, photo, { mime: 'image/jpeg' });
  const raw = await p.bia.api.post(`/v1/media/${m.body.mediaId}/open`, undefined, { binary: true });
  assert.equal(raw[3], 2, 'formato com degrau');
  assert.equal(raw.byteLength, 16 + 65536 + 16, 'servidor vê só o degrau de 64 KiB');
  const got = (await p.bia.sync()).received.find((x) => x.msgId === m.msgId);
  assert.deepEqual(await p.bia.openMedia({ ...got, body: got.body }), photo);
});

test('enquete e voto: só membro, opções válidas, um voto por pessoa', async () => {
  const poll = await p.ana.sendPoll(room, 'Pizza ou sushi?', ['pizza', 'sushi'], false);
  await p.bia.sync(); await p.caio.sync();
  await p.bia.vote(room, poll.msgId, [1]);
  await p.caio.vote(room, poll.msgId, [0, 1]); // duas opções numa enquete de uma só: ignorado
  await p.ana.sync();
  const v = await p.ana.store.getMessage(poll.msgId);
  assert.deepEqual(v.votes[p.bia.userId], [1]);
  assert.equal(v.votes[p.caio.userId], undefined);
  await p.caio.vote(room, poll.msgId, [0]);
  await p.ana.sync();
  assert.deepEqual((await p.ana.store.getMessage(poll.msgId)).votes[p.caio.userId], [0]);
});

test('fixar mensagem (até 3) e favoritar: só no prazo da mensagem', async () => {
  const msgs = [];
  for (let i = 0; i < 4; i++) msgs.push(await p.bia.sendText(room, `fixe ${i}`));
  await p.ana.sync();
  for (const m of msgs) await p.ana.pin(room, m.msgId, Date.now() + 86_400_000);
  await p.bia.sync();
  const pins = await p.bia.pinsOf(room);
  assert.deepEqual(pins.map((x) => x.message.text), ['fixe 1', 'fixe 2', 'fixe 3'], 'no máximo 3, sai o mais antigo');
  assert.ok(pins.every((x) => x.until <= x.message.expiresAt), 'nunca passa do prazo da mensagem');
  await p.ana.pin(room, msgs[3].msgId, 0);
  await p.bia.sync();
  assert.equal((await p.bia.pinsOf(room)).length, 2);
  await p.bia.star(msgs[0].msgId, true);
  assert.equal((await p.bia.store.getMessage(msgs[0].msgId)).starred, true);
});

test('b.7: áudio de ver uma vez abre uma vez para quem recebe', async () => {
  const audio = new Uint8Array(3000).map((_, i) => i % 200);
  const m = await p.ana.sendMedia(room, audio, { mode: 'once', mime: 'audio/webm;codecs=opus', duration: 2000 });
  assert.equal(m.body.key, null, 'quem enviou não guarda a chave');
  const got = (await p.bia.sync()).received.find((x) => x.msgId === m.msgId);
  assert.deepEqual(await p.bia.openMedia(await p.bia.store.getMessage(got.msgId)), audio);
  await assert.rejects(p.bia.openMedia(await p.bia.store.getMessage(got.msgId)), /sem chave/);
});
