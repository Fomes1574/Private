// Tempo real: só autentica pelo subprotocolo e só manda "sincronize".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi, newDevice, Client, SETUP, fakeCt, msgId } from './helpers.mjs';

let api;
before(async () => { api = await startApi(8796); });
after(() => api?.stop());

test('WebSocket: token no subprotocolo; aviso sem conteúdo quando chega mensagem', async () => {
  const devA = await newDevice();
  const a = new Client(api.base);
  const r = await a.post('/v1/bootstrap', { setupCode: SETUP, device: devA.public });
  await a.login(devA, r.data.deviceId);
  const inv = await a.post('/v1/invites', {});
  const devB = await newDevice();
  const b = new Client(api.base);
  const rb = await b.post('/v1/invites/redeem', { token: inv.data.token, device: devB.public });
  await b.login(devB, rb.data.deviceId);

  const wsUrl = api.base.replace('http', 'ws') + '/v1/live';
  const bad = new WebSocket(wsUrl, ['mp-v1', 'x'.repeat(50)]);
  const badResult = await new Promise((res) => { bad.onopen = () => res('open'); bad.onerror = () => res('error'); bad.onclose = () => res('closed'); });
  assert.notEqual(badResult, 'open', 'token falso não conecta');

  const ws = new WebSocket(wsUrl, ['mp-v1', b.token]);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const got = new Promise((res) => { ws.onmessage = (ev) => res(ev.data); });
  const room = await a.post('/v1/rooms', { kind: 'direct', members: [b.userId] });
  await a.post(`/v1/rooms/${room.data.roomId}/messages`, { msgId: msgId(), kind: 'text', envelopes: { [b.userId]: fakeCt() } });
  assert.equal(await got, '{"t":"sync"}');
  ws.close();
});
