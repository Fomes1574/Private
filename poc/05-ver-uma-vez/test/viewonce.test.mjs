// Sobe o Worker com `wrangler dev` (workerd local, DO e R2 simulados) e testa
// pela API, como um cliente faria.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const DAY = 86400;

async function startWorker(port, extra = []) {
  const secret = randomBytes(32).toString('base64');
  const bin = new URL('../node_modules/.bin/wrangler', import.meta.url).pathname;
  const proc = spawn(bin, ['dev', '--local', '--port', String(port), '--ip', '127.0.0.1',
    '--var', `TOKEN_SECRET:${secret}`, '--var', 'DEV_TOKENS:1', '--var', 'DEV_MIN_TTL:2', ...extra], {
    cwd: new URL('..', import.meta.url).pathname, stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  proc.stderr.on('data', (d) => { out += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(`${base}/v1/x`); if (r.status === 401) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  // Mata o grupo inteiro (wrangler + workerd) para não deixar a porta presa.
  return { base, stop: () => { try { process.kill(-proc.pid, 'SIGTERM'); } catch {} }, log: () => out };
}

function client(base) {
  const tokens = {};
  const token = async (m) => (tokens[m] ??= (await (await fetch(`${base}/v1/dev/token`, { method: 'POST', body: JSON.stringify({ member: m }) })).json()).token);
  return {
    async send(from, to, bytes, ttl = 5 * DAY) {
      const r = await fetch(`${base}/v1/media?ttl=${ttl}&to=${to.join(',')}`, { method: 'POST', body: bytes, headers: { authorization: `Bearer ${await token(from)}` } });
      return { status: r.status, body: await r.json() };
    },
    async open(who, id) {
      const r = await fetch(`${base}/v1/media/${id}/open`, { method: 'POST', headers: { authorization: `Bearer ${await token(who)}` } });
      return { status: r.status, bytes: r.headers.get('content-type') === 'application/octet-stream' ? new Uint8Array(await r.arrayBuffer()) : null, body: r.headers.get('content-type') === 'application/json' ? await r.json() : null };
    },
    async post(who, id, action, body) {
      const r = await fetch(`${base}/v1/media/${id}/${action}`, { method: 'POST', body: body && JSON.stringify(body), headers: { authorization: `Bearer ${await token(who)}` } });
      return { status: r.status, body: await r.json() };
    },
  };
}

const SUITES = (process.env.SUITES || 'do,r2').split(',');
for (const [backend, port, extra] of [['do', 8799, []], ['r2', 8798, ['--env', 'r2']]].filter(([b]) => SUITES.includes(b))) {
  describe(`ver uma vez (${backend})`, { timeout: 120000 }, () => {
    let w, c;
    before(async () => { w = await startWorker(port, extra); c = client(w.base); });
    after(() => w?.stop());

    test('cada destinatário abre uma vez; remetente nunca; último apaga', async () => {
      const blob = randomBytes(3_000_000); // 2 pedaços no modo DO
      const s = await c.send('ana', ['bia', 'caio'], blob);
      assert.equal(s.status, 201);
      assert.ok(s.body.expiresAt - s.body.acceptedAt === 5 * DAY * 1000);
      const id = s.body.mediaId;

      assert.equal((await c.open('ana', id)).status, 403, 'remetente não reabre');
      assert.equal((await c.open('davi', id)).status, 403, 'quem não é destinatário não abre');

      const b1 = await c.open('bia', id);
      assert.equal(b1.status, 200);
      assert.equal(Buffer.compare(Buffer.from(b1.bytes), blob), 0, 'bytes iguais aos enviados');
      const b2 = await c.open('bia', id);
      assert.equal(b2.status, 410);
      assert.equal(b2.body.error, 'used');

      const c1 = await c.open('caio', id);
      assert.equal(c1.status, 200, 'quem ainda não viu continua podendo');
      assert.equal((await c.open('caio', id)).status, 404, 'último consumo apagou tudo');
    });

    test('20 pedidos simultâneos do mesmo destinatário: só 1 abre', async () => {
      const { body } = await c.send('ana', ['bia'], randomBytes(1000));
      const results = await Promise.all(Array.from({ length: 20 }, () => c.open('bia', body.mediaId)));
      assert.equal(results.filter((r) => r.status === 200).length, 1);
    });

    test('apagar para todos: só o autor, revoga pendentes e apaga', async () => {
      const { body } = await c.send('ana', ['bia', 'caio'], randomBytes(1000));
      assert.equal((await c.post('bia', body.mediaId, 'revoke')).status, 403);
      assert.equal((await c.post('ana', body.mediaId, 'revoke')).status, 200);
      assert.equal((await c.open('bia', body.mediaId)).status, 404);
    });

    test('membro removido perde o direito e não segura a limpeza', async () => {
      const { body } = await c.send('ana', ['bia', 'caio'], randomBytes(1000));
      assert.equal((await c.open('bia', body.mediaId)).status, 200);
      assert.equal((await c.post('ana', body.mediaId, 'remove', { member: 'caio' })).status, 200);
      assert.equal((await c.open('caio', body.mediaId)).status, 404, 'sem pendentes: apagado');
    });

    test('prazo vence: ninguém abre e o objeto some (alarme)', async () => {
      const { body } = await c.send('ana', ['bia'], randomBytes(1000), 2);
      await new Promise((r) => setTimeout(r, 3500));
      const r = await c.open('bia', body.mediaId);
      assert.ok([404, 410].includes(r.status), `esperava vencido, veio ${r.status}`);
    });

    test('validações: prazo fora da faixa, destinatários, token', async () => {
      assert.equal((await c.send('ana', ['bia'], randomBytes(10), 16 * DAY)).status, 400);
      assert.equal((await c.send('ana', ['ana'], randomBytes(10))).status, 400);
      assert.equal((await c.send('ana', Array.from({ length: 10 }, (_, i) => `p${i}`), randomBytes(10))).status, 400);
      const r = await fetch(`${w.base}/v1/media?ttl=${DAY}&to=bia`, { method: 'POST', body: 'x', headers: { authorization: 'Bearer abc.def' } });
      assert.equal(r.status, 401);
      const err = await r.text();
      assert.doesNotMatch(err, /abc|def/, 'erro não ecoa a entrada');
    });
  });
}
