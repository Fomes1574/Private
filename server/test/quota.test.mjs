// Cota interna (§24) e limite de tráfego (§8), com uma API própria de cota pequena.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { startApi, newDevice, Client, SETUP } from './helpers.mjs';

let api, a, b, g;
before(async () => {
  api = await startApi(8796, { vars: { MEDIA_QUOTA_BYTES: String(5_000_000) } });
  const dev = await newDevice(); a = new Client(api.base);
  const r = await a.post('/v1/bootstrap', { setupCode: SETUP, device: dev.public }); await a.login(dev, r.data.deviceId);
  const inv = await a.post('/v1/invites', {}); const d2 = await newDevice(); b = new Client(api.base);
  const rr = await b.post('/v1/invites/redeem', { token: inv.data.token, device: d2.public }); await b.login(d2, rr.data.deviceId);
  g = (await a.post('/v1/rooms', { kind: 'group', members: [b.userId] })).data.roomId;
});
after(() => api?.stop());

test('cota: passou do limite, o upload é negado sem guardar nada; apagar devolve espaço', async () => {
  const up1 = await a.post(`/v1/rooms/${g}/media?mode=media`, new Uint8Array(3_000_000));
  assert.equal(up1.status, 201);
  const up2 = await a.post(`/v1/rooms/${g}/media?mode=media`, new Uint8Array(3_000_000));
  assert.equal(up2.status, 507, 'acima da cota');
  assert.equal(up2.data.error, 'storage_full');
  // Foto de perfil também conta.
  assert.equal((await b.post(`/v1/visual/user/${b.userId}/profile`, new Uint8Array(2_100_000))).status, 413);
  assert.equal((await b.post(`/v1/visual/user/${b.userId}/profile`, new Uint8Array(1_900_000))).status, 201);
  assert.equal((await a.post(`/v1/rooms/${g}/media?mode=media`, new Uint8Array(200_000))).status, 507, 'perfil ocupou o resto');
  assert.equal((await a.post(`/v1/media/${up1.data.mediaId}/revoke`)).status, 200);
  assert.equal((await a.post(`/v1/rooms/${g}/media?mode=media`, new Uint8Array(3_000_000))).status, 201, 'espaço devolvido ao apagar');
});

test('foto de perfil fica no R2 com prefixo próprio (fora da regra de 16 dias)', { skip: (process.env.MP_TEST_BACKEND || 'r2') !== 'r2' }, async () => {
  const files = execSync(`find ${api.persist} -path '*r2*' -type f -size +1000k`).toString().trim().split('\n').filter(Boolean);
  assert.ok(files.length >= 2, `mídia e foto no R2: ${files.length}`);
});

test('limite de tráfego: rajada de escritas da mesma pessoa vira 429', async () => {
  let limited = 0;
  const reqs = Array.from({ length: 330 }, () => a.post('/v1/push', { endpoint: null }).then((r) => { if (r.status === 429) limited++; }));
  await Promise.all(reqs);
  assert.ok(limited > 0, 'cortado acima de 300/min');
  assert.notEqual((await b.get('/v1/me')).status, 429, 'outra pessoa não é afetada; leitura não conta');
});
