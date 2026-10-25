// Entrega A2 no servidor: F04 (apagar para todos revoga a mídia), F05
// (encerrar revoga ver uma vez pendente), F16 (cota no próprio envio), S12
// (chave da parte S destruída no R2) e S13 (alarme de vencimento apaga a mídia).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startApi, newDevice, Client, SETUP, fakeCt, msgId } from './helpers.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const bin = fileURLToPath(new URL('../node_modules/.bin/wrangler', import.meta.url));
let api;
const p = {};
before(async () => {
  api = await startApi(8798);
  const dev = await newDevice();
  const admin = new Client(api.base);
  const r = await admin.post('/v1/bootstrap', { setupCode: SETUP, device: dev.public });
  await admin.login(dev, r.data.deviceId);
  p.admin = admin;
  for (const name of ['bia', 'caio']) {
    const inv = await admin.post('/v1/invites', {});
    const d = await newDevice();
    const c = new Client(api.base);
    const j = await c.post('/v1/invites/redeem', { token: inv.data.token, device: d.public });
    await c.login(d, j.data.deviceId);
    p[name] = c;
  }
});
after(() => api?.stop());

// Existe no R2 local? (sem baixar conteúdo: só o código de saída)
function r2Has(key) {
  try {
    execFileSync(bin, ['r2', 'object', 'get', `mp-media/${key}`, '--local', '--persist-to', api.persist, '--pipe'], { cwd: root, stdio: ['ignore', 'ignore', 'ignore'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
    return true;
  } catch { return false; }
}
const blob = (n = 4000) => new Uint8Array(randomBytes(n));

async function group() {
  const r = await p.admin.post('/v1/rooms', { kind: 'group', members: [p.bia.userId, p.caio.userId] });
  assert.equal(r.status, 201, JSON.stringify(r));
  return r.data.roomId;
}
const envs = (...users) => Object.fromEntries(users.map((u) => [u.userId, fakeCt()]));

test('F04: apagar para todos revoga a mídia no servidor, sem chamada separada', async () => {
  const room = await group();
  const up = await p.admin.post(`/v1/rooms/${room}/media?mode=media`, blob());
  const id = msgId();
  const sent = await p.admin.post(`/v1/rooms/${room}/messages`, { msgId: id, kind: 'media', mediaId: up.data.mediaId, envelopes: envs(p.bia, p.caio) });
  assert.equal(sent.status, 201, JSON.stringify(sent));
  assert.equal((await p.bia.post(`/v1/media/${up.data.mediaId}/open`, undefined, { raw: true })).status, 200);
  assert.equal((await p.admin.post(`/v1/rooms/${room}/messages/${id}/delete`)).status, 200);
  assert.equal((await p.bia.post(`/v1/media/${up.data.mediaId}/open`)).status, 404, 'a referência antiga não abre mais');
  assert.equal(r2Has(`m/${up.data.mediaId}`), false, 'objeto saiu do R2');
});

test('F04: não dá para ligar à mensagem a mídia de outra pessoa ou de outra conversa', async () => {
  const room = await group();
  const other = await group();
  const mine = await p.bia.post(`/v1/rooms/${room}/media?mode=media`, blob());
  const r1 = await p.admin.post(`/v1/rooms/${room}/messages`, { msgId: msgId(), kind: 'media', mediaId: mine.data.mediaId, envelopes: envs(p.bia, p.caio) });
  assert.equal(r1.status, 403, 'mídia da Bia');
  const up = await p.admin.post(`/v1/rooms/${other}/media?mode=media`, blob());
  const r2 = await p.admin.post(`/v1/rooms/${room}/messages`, { msgId: msgId(), kind: 'media', mediaId: up.data.mediaId, envelopes: envs(p.bia, p.caio) });
  assert.equal(r2.status, 403, 'mídia de outra conversa');
  assert.equal((await p.bia.post(`/v1/media/${mine.data.mediaId}/open`, undefined, { raw: true })).status, 200, 'nada foi revogado');
});

test('F05: desfazer vínculo revoga o ver uma vez ainda não aberto', async () => {
  const d = await p.admin.post('/v1/rooms', { kind: 'direct', members: [p.bia.userId] });
  const room = d.data.roomId;
  const once = await p.admin.post(`/v1/rooms/${room}/media?mode=once`, blob());
  const normal = await p.admin.post(`/v1/rooms/${room}/media?mode=media`, blob());
  assert.equal((await p.bia.post(`/v1/rooms/${room}/events`, { type: 'unlink' })).status, 200);
  assert.equal((await p.bia.post(`/v1/media/${once.data.mediaId}/open`)).status, 404, 'ver uma vez some');
  assert.equal((await p.bia.post(`/v1/media/${normal.data.mediaId}/open`, undefined, { raw: true })).status, 200, 'mídia comum fica para leitura até vencer');
});

test('F16: documento entra na cota no próprio envio; o 4º revoga o mais antigo', async () => {
  const room = await group();
  const docs = [];
  for (let i = 0; i < 4; i++) {
    const up = await p.caio.post(`/v1/rooms/${room}/media?mode=doc`, blob(800));
    const id = msgId();
    const r = await p.caio.post(`/v1/rooms/${room}/messages`, { msgId: id, kind: 'media', mediaId: up.data.mediaId, envelopes: envs(p.admin, p.bia) });
    assert.equal(r.status, 201, JSON.stringify(r));
    assert.ok(r.data.quota, 'a resposta traz a cota');
    docs.push({ mediaId: up.data.mediaId, msgId: id, quota: r.data.quota });
  }
  assert.deepEqual(docs[3].quota.evicted, [docs[0].mediaId]);
  assert.equal((await p.bia.post(`/v1/media/${docs[0].mediaId}/open`)).status, 404);
  const s = await p.bia.get('/v1/sync');
  assert.ok(s.data.tombstones.some((t) => t.msgId === docs[0].msgId), 'o mais antigo some para todos');
  // Reenvio da mesma mensagem não conta duas vezes.
  const again = await p.caio.post(`/v1/rooms/${room}/messages`, { msgId: docs[3].msgId, kind: 'media', mediaId: docs[3].mediaId, envelopes: envs(p.admin, p.bia) });
  assert.equal(again.status, 200);
  assert.equal((await p.caio.get('/v1/docs/mine')).data.active, 3);
});

test('S13: o alarme de vencimento apaga a mídia do R2 e do Durable Object', async () => {
  const room = await group();
  const up = await p.admin.post(`/v1/rooms/${room}/media?mode=media`, blob());
  assert.equal(r2Has(`m/${up.data.mediaId}`), true);
  assert.equal((await new Client(api.base).post(`/__test/media/${up.data.mediaId}/alarm`)).status, 200);
  assert.equal(r2Has(`m/${up.data.mediaId}`), false, 'objeto saiu do R2');
  assert.equal((await p.bia.post(`/v1/media/${up.data.mediaId}/open`)).status, 404, 'abrir devolve que não existe mais');
});

test('S12: a parte S fica cifrada por chave no R2; destruir o cofre destrói a chave', async () => {
  const ok = randomBytes(32).toString('base64');
  const reg = await p.bia.post('/v1/vault/register', { verifier: ok, deadDays: 15 });
  assert.equal(reg.status, 201);
  const { vaultId, share } = reg.data;
  assert.equal(r2Has(`k/${vaultId}`), true, 'chave do cofre no R2');
  const rel = await new Client(api.base).post('/v1/vault/release', { vaultId, verifier: ok });
  assert.equal(rel.data.share, share, 'abre normalmente');
  const wrong = randomBytes(32).toString('base64');
  for (let i = 0; i < 5; i++) await new Client(api.base).post('/v1/vault/release', { vaultId, verifier: wrong });
  assert.equal((await new Client(api.base).post('/v1/vault/release', { vaultId, verifier: ok })).status, 404);
  let gone = false;
  for (let i = 0; i < 20 && !gone; i++) { gone = !r2Has(`k/${vaultId}`); if (!gone) await new Promise((r) => setTimeout(r, 250)); }
  assert.ok(gone, 'chave apagada do R2: um SQLite restaurado do histórico não abre mais');
});
