// Parte do servidor na chave do aparelho (ADR 0014): erros contados aqui,
// PIN de coação, interruptor do homem morto e código de emergência.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { startApi, newDevice, Client, SETUP } from './helpers.mjs';

let api, admin;
const v32 = () => randomBytes(32).toString('base64');
before(async () => {
  api = await startApi(8798, { vars: { VAULT_DAY_MS: '1500' } }); // "1 dia" = 1,5 s
  const dev = await newDevice(); admin = new Client(api.base);
  const r = await admin.post('/v1/bootstrap', { setupCode: SETUP, device: dev.public }); await admin.login(dev, r.data.deviceId);
});
after(() => api?.stop());
async function person() {
  const inv = await admin.post('/v1/invites', {});
  const d = await newDevice(); const c = new Client(api.base);
  const r = await c.post('/v1/invites/redeem', { token: inv.data.token, device: d.public }); await c.login(d, r.data.deviceId);
  return c;
}
const release = (vaultId, verifier) => new Client(api.base).post('/v1/vault/release', { vaultId, verifier });

test('só abre com o PIN certo; 5 erros contados no servidor destroem a parte e derrubam a sessão', async () => {
  const p = await person(), ok = v32();
  assert.equal((await new Client(api.base).post('/v1/vault/register', { verifier: ok })).status, 401, 'registrar exige sessão');
  const reg = await p.post('/v1/vault/register', { verifier: ok, deadDays: 15 });
  assert.equal(reg.status, 201);
  const got = await release(reg.data.vaultId, ok);
  assert.equal(got.data.share, reg.data.share);
  for (let i = 4; i >= 1; i--) {
    const w = await release(reg.data.vaultId, v32());
    assert.equal(w.status, 403); assert.equal(w.data.left, i);
  }
  assert.equal((await release(reg.data.vaultId, ok)).status, 200, 'acerto zera o contador');
  for (let i = 0; i < 4; i++) await release(reg.data.vaultId, v32());
  assert.equal((await release(reg.data.vaultId, v32())).status, 404, '5º erro seguido: destruída');
  assert.equal((await release(reg.data.vaultId, ok)).status, 404, 'nem com o PIN certo depois');
  assert.equal((await p.get('/v1/me')).status, 401, 'sessão do aparelho caiu');
});

test('PIN de coação: resposta igual a "apagado" e a parte some', async () => {
  const p = await person(), ok = v32(), duress = v32();
  const reg = await p.post('/v1/vault/register', { verifier: ok, duress, deadDays: 15 });
  const d = await release(reg.data.vaultId, duress);
  assert.equal(d.status, 404);
  assert.deepEqual(d.data, { error: 'gone' }, 'sem pista de que foi coação');
  assert.equal((await release(reg.data.vaultId, ok)).status, 404);
});

test('interruptor do homem morto: aparelho sumido além do prazo perde a parte', async () => {
  const p = await person(), ok = v32();
  const reg = await p.post('/v1/vault/register', { verifier: ok, deadDays: 1 });
  assert.equal((await release(reg.data.vaultId, ok)).status, 200);
  await new Promise((r) => setTimeout(r, 2000));
  assert.equal((await release(reg.data.vaultId, ok)).status, 404, 'passou do prazo sem aparecer');
  const p2 = await person(), ok2 = v32();
  const reg2 = await p2.post('/v1/vault/register', { verifier: ok2, deadDays: 0 });
  await new Promise((r) => setTimeout(r, 2000));
  assert.equal((await release(reg2.data.vaultId, ok2)).status, 200, 'desligado (0) não vence');
});

test('código de emergência: de qualquer lugar, mata os aparelhos da pessoa; código errado não revela nada', async () => {
  const p = await person(), ok = v32();
  const reg = await p.post('/v1/vault/register', { verifier: ok, deadDays: 15 });
  const code = randomBytes(18).toString('base64url');
  assert.equal((await p.post('/v1/vault/kill-code', { codeHash: createHash('sha256').update(code).digest('hex') })).status, 200);
  assert.deepEqual((await new Client(api.base).post('/v1/vault/kill', { code: randomBytes(18).toString('base64url') })).data, { ok: true });
  assert.equal((await release(reg.data.vaultId, ok)).status, 200, 'código errado não mexe em nada');
  assert.deepEqual((await new Client(api.base).post('/v1/vault/kill', { code })).data, { ok: true });
  assert.equal((await release(reg.data.vaultId, ok)).status, 404, 'aparelho morto');
  assert.equal((await p.get('/v1/me')).status, 401);
});

test('ajustes do cofre: só o próprio aparelho muda prazo e PIN de coação; valores fora da lista recusados', async () => {
  const p = await person(), q = await person(), ok = v32();
  const reg = await p.post('/v1/vault/register', { verifier: ok, deadDays: 15 });
  assert.equal((await q.post('/v1/vault/settings', { vaultId: reg.data.vaultId, deadDays: 0 })).status, 404, 'outra pessoa não mexe');
  assert.equal((await p.post('/v1/vault/settings', { vaultId: reg.data.vaultId, deadDays: 2 })).status, 400);
  const duress = v32();
  assert.equal((await p.post('/v1/vault/settings', { vaultId: reg.data.vaultId, deadDays: 7, duress })).status, 200);
  assert.equal((await release(reg.data.vaultId, duress)).status, 404, 'coação nova vale');
  assert.equal((await p.get('/v1/me')).status, 401, 'coação também derruba a sessão');
  assert.equal((await q.post('/v1/vault/register', { verifier: 'curto', deadDays: 15 })).status, 400);
});
