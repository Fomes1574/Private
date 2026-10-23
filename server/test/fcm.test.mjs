// Notificação do APK Android pelo FCM, contra um FCM falso local (dados de
// teste; nenhuma chave real). Confere o que SAI do servidor: só o token e uma
// constante, nada de conversa, remetente, id de mensagem ou cifra. Confere
// também silenciar, app aberto, token que deixou de valer, desligar e troca
// de aparelho.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { webcrypto as wc, randomBytes } from 'node:crypto';
import { startApi, newDevice, Client, SETUP, fakeCt, msgId } from './helpers.mjs';
import { fcmMessage } from '../src/fcm.js';

const MOCK = 8899;
const MOCK_BASE = `http://127.0.0.1:${MOCK}`;
const fcmToken = () => `${randomBytes(16).toString('base64url')}:APA91b${randomBytes(110).toString('base64url')}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let api, mock, publicKey;
const sends = [];
const grants = [];
const gone = new Set();

before(async () => {
  const kp = await wc.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  publicKey = kp.publicKey;
  const label = ['PRIVATE', 'KEY'].join(' ');
  const pem = `-----BEGIN ${label}-----\n${Buffer.from(await wc.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64').replace(/.{64}/g, '$&\n')}\n-----END ${label}-----\n`;
  const sa = { type: 'service_account', project_id: 'proj-teste', private_key_id: 'kid-teste', private_key: pem, client_email: 'aviso@proj-teste.iam.gserviceaccount.com', token_uri: `${MOCK_BASE}/token` };

  mock = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    if (req.url === '/token') {
      const assertion = new URLSearchParams(body).get('assertion');
      const [h, p, s] = assertion.split('.');
      const ok = await wc.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, Buffer.from(s, 'base64url'), new TextEncoder().encode(`${h}.${p}`));
      grants.push({ ok, header: JSON.parse(Buffer.from(h, 'base64url')), claims: JSON.parse(Buffer.from(p, 'base64url')) });
      res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(ok ? { access_token: 'acesso-teste', expires_in: 3600 } : {}));
    }
    const sent = { url: req.url, auth: req.headers.authorization, raw: body, body: JSON.parse(body) };
    sends.push(sent);
    if (gone.has(sent.body.message.token)) {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } }));
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ name: 'projects/proj-teste/messages/1' }));
  }).listen(MOCK, '127.0.0.1');

  api = await startApi(8797, { vars: { FCM_SERVICE_ACCOUNT: JSON.stringify(sa), FCM_API_BASE: MOCK_BASE } });
});
after(() => { api?.stop(); mock?.close(); });

const sentTo = (token) => sends.filter((s) => s.body.message.token === token);
async function until(fn, ms = 8000) {
  for (let t = 0; t < ms; t += 100) { if (fn()) return true; await wait(100); }
  return false;
}

test('FCM: aviso vazio, só para quem precisa, e limpeza de token', async () => {
  const devA = await newDevice();
  const ana = new Client(api.base);
  const r = await ana.post('/v1/bootstrap', { setupCode: SETUP, device: devA.public });
  await ana.login(devA, r.data.deviceId);
  async function person() {
    const inv = await ana.post('/v1/invites', {});
    const dev = await newDevice();
    const c = new Client(api.base);
    const rr = await c.post('/v1/invites/redeem', { token: inv.data.token, device: dev.public });
    await c.login(dev, rr.data.deviceId);
    c.room = (await ana.post('/v1/rooms', { kind: 'direct', members: [c.userId] })).data.roomId;
    return c;
  }
  const send = (c) => { const id = msgId(); return ana.post(`/v1/rooms/${c.room}/messages`, { msgId: id, kind: 'text', envelopes: { [c.userId]: fakeCt() } }).then(() => id); };
  const [bia, caio, duda, eva, fabio] = [await person(), await person(), await person(), await person(), await person()];
  // Push ativado só depois de montar o círculo (entrar e criar conversa também avisam).
  await wait(500);
  for (const c of [bia, caio, duda, eva, fabio]) {
    c.fcm = fcmToken();
    assert.equal((await c.post('/v1/push', { fcm: c.fcm })).status, 200);
  }

  assert.equal(sends.length, 0, 'nada enviado antes de ativar');

  // Entrada inválida: token malformado, push para um endereço qualquer.
  assert.equal((await bia.post('/v1/push', { fcm: 'x' })).status, 400);
  assert.equal((await bia.post('/v1/push', { fcm: 'https://exemplo.invalid/a' + 'b'.repeat(120) })).status, 400);
  assert.equal((await bia.post('/v1/push', { endpoint: 'https://exemplo.invalid/push/abc' })).status, 400, 'Web Push só para serviços de push conhecidos');
  assert.equal((await bia.post('/v1/push', { endpoint: 'https://web.push.apple.com:8443/abc' })).status, 400);
  assert.equal((await bia.post('/v1/push', { fcm: bia.fcm })).status, 200);

  // 1) Bia com o app fechado: um aviso, e só isto.
  const id = await send(bia);
  assert.ok(await until(() => sentTo(bia.fcm).length === 1), 'aviso chegou ao FCM');
  const s = sentTo(bia.fcm)[0];
  assert.equal(s.url, '/v1/projects/proj-teste/messages:send');
  assert.equal(s.auth, 'Bearer acesso-teste');
  assert.deepEqual(s.body, fcmMessage(bia.fcm));
  assert.deepEqual(s.body, { message: { token: bia.fcm, data: { v: '1' }, android: { priority: 'HIGH', ttl: '86400s', collapse_key: 'mp' } } });
  for (const leak of [bia.room, id, ana.userId, bia.userId, 'notification', 'title']) assert.ok(!s.raw.includes(leak), `nada de ${leak} no aviso`);
  // Conta de serviço: JWT RS256 assinado, escopo só de mensagens.
  assert.equal(grants.length, 1);
  assert.equal(grants[0].ok, true);
  assert.deepEqual(grants[0].header, { alg: 'RS256', typ: 'JWT', kid: 'kid-teste' });
  assert.equal(grants[0].claims.scope, 'https://www.googleapis.com/auth/firebase.messaging');
  assert.equal(grants[0].claims.aud, `${MOCK_BASE}/token`);
  assert.equal(grants[0].claims.exp - grants[0].claims.iat, 3600);

  // 2) Caio silenciou a conversa: nada vai ao FCM.
  assert.equal((await caio.post(`/v1/rooms/${caio.room}/mute`, { until: Date.now() + 3600_000 })).status, 200);
  await send(caio);
  // 3) Duda com o app aberto (WebSocket): só o aviso pelo socket.
  const ws = new WebSocket(api.base.replace('http', 'ws') + '/v1/live', ['mp-v1', duda.token]);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  const viaSocket = new Promise((ok) => { ws.onmessage = (e) => ok(e.data); });
  await send(duda);
  assert.equal(await viaSocket, '{"t":"sync"}');
  // 4) Eva: o FCM diz que o token não vale mais (app desinstalado).
  gone.add(eva.fcm);
  await send(eva);
  assert.ok(await until(() => sentTo(eva.fcm).length === 1));
  await wait(1500);
  assert.equal(sentTo(caio.fcm).length, 0, 'silenciado não recebe push');
  assert.equal(sentTo(duda.fcm).length, 0, 'app aberto não recebe push');
  ws.close();

  // Mudanças antes da segunda rodada:
  // - Duda desliga as notificações;
  assert.equal((await duda.post('/v1/push', { endpoint: null })).status, 200);
  // - Bia troca de aparelho (o antigo é revogado e perde o push).
  const fresh = new Client(api.base);
  const newDev = await newDevice();
  const start = await fresh.post('/v1/devices/pair/start', { device: newDev.public });
  const ok = await bia.post('/v1/devices/pair/approve', { pairingId: start.data.pairingId, code: start.data.code });
  assert.equal(ok.status, 200);
  await fresh.login(newDev, ok.data.deviceId);
  assert.equal((await fresh.post('/v1/vault/register', { verifier: randomBytes(32).toString('base64'), deadDays: 15 })).status, 201);
  assert.equal((await fresh.post('/v1/devices/pair/commit')).status, 200);

  // Segunda rodada depois do intervalo mínimo de 1 min por pessoa.
  await wait(61_000);
  await Promise.all([send(bia), send(duda), send(eva), send(fabio)]);
  assert.ok(await until(() => sentTo(fabio.fcm).length === 1), 'controle: o FCM falso continua recebendo');
  await wait(1500);
  assert.equal(sentTo(bia.fcm).length, 1, 'aparelho revogado não recebe mais');
  assert.equal(sentTo(duda.fcm).length, 0, 'desligado não recebe');
  assert.equal(sentTo(eva.fcm).length, 1, 'token que deixou de valer foi apagado');
  assert.equal(grants.length, 1, 'token de acesso reaproveitado');
});
