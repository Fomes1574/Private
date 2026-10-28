// E3: mede o desbloqueio até a lista aparecer, etapa por etapa, num cenário
// pesado: 6 conversas com 250 mensagens guardadas cada e 40 mensagens novas
// chegando enquanto o app estava trancado, com 120 ms de atraso por pedido
// (rede de celular). Simulação em Chromium: não substitui medir no celular.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { startApi, SETUP } from '../../server/test/helpers.mjs';
import { browser, virtualAuthenticator } from '../../e2e/helpers.mjs';
import { loadCrypto } from '../../packages/crypto/index.js';
import { TrustedClock } from '../../packages/protocol/src/time.js';
import { MessengerClient, Api, MemoryStore } from '../../packages/client/src/index.js';

await loadCrypto(await readFile(new URL('../../packages/crypto/pkg/mp_crypto_bg.wasm', import.meta.url)));

const PORT = 8822;
const APP = `http://localhost:${PORT}`;
const PIN = '284917';
const ROOMS = 6, STORED = 250, INCOMING = 40, DELAY = 120;
const dist = new URL('../dist', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json' };
let api, server, ctx, page;

before(async () => {
  api = await startApi(8823, { appOrigin: APP });
  execFileSync(process.execPath, ['build.mjs'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, MP_MODE: 'plain', MP_API: api.base, MP_TEST_HOOKS: '1' }, stdio: 'ignore' });
  server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, APP).pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = path.endsWith('/') ? `${path}index.html` : path;
    try {
      const body = await readFile(join(dist, file));
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  }).listen(PORT, '127.0.0.1');
});
after(async () => { await ctx?.close(); server?.close(); api?.stop(); });

const marks = () => page.evaluate(() => {
  const all = performance.getEntriesByType('mark').filter((m) => m.name.startsWith('mp:'));
  const start = all.filter((m) => m.name === 'mp:unlock:start').at(-1)?.startTime ?? 0;
  const out = {};
  for (const m of all) if (m.startTime >= start) out[m.name.slice(3)] ??= Math.round(m.startTime - start);
  return out;
});

test('E3: tempo do PIN até a lista, por etapa', async () => {
  ctx = await browser(); page = await ctx.newPage(); await virtualAuthenticator(page);
  await page.goto(`${APP}/#instalar`);
  await page.click('text=Instalar a primeira pessoa');
  await page.fill('#s1', PIN); await page.fill('#s2', PIN); await page.click('form button');
  await page.fill('#token', SETUP); await page.click('text=Entrar');
  await page.fill('#nick', 'Ana'); await page.click('form button'); await page.waitForSelector('#search');

  // Bia, fora do navegador, entra pelo convite (dados sintéticos).
  const token = await page.evaluate(async () => (await globalThis.__mpTest.S.client.api.post('/v1/invites', {})).token);
  const bia = new MessengerClient({ api: new Api(api.base, new TrustedClock()), store: new MemoryStore(), pickleKey: crypto.getRandomValues(new Uint8Array(32)) });
  await bia.redeem(token); await bia.login(); await bia.refreshDirectory();

  const rooms = await page.evaluate(async ({ biaId, ROOMS, STORED }) => {
    const { S } = globalThis.__mpTest;
    await S.client.refreshDirectory();
    const ids = [];
    for (let i = 0; i < ROOMS; i++) ids.push((await S.client.createRoom('group', [biaId])).roomId);
    const now = S.clock.now();
    for (const room of ids) for (let i = 0; i < STORED; i++) {
      await S.store.putMessage({ msgId: `perf${room.slice(0, 6)}${String(i).padStart(4, '0')}`, room, sender: i % 2 ? S.client.userId : biaId, kind: 'text', text: `mensagem sintética ${i} `.repeat(4), acceptedAt: now - (STORED - i) * 1000, expiresAt: now + 86_400_000 });
    }
    return ids;
  }, { biaId: bia.userId, ROOMS, STORED });

  await page.evaluate(() => globalThis.__mpTest.lock('manual'));
  await page.waitForSelector('#secret');
  await bia.sync();
  for (let i = 0; i < INCOMING; i++) await bia.sendText(rooms[i % rooms.length], `nova ${i}`);

  // Rede de celular: cada pedido à API espera um pouco.
  await page.route(`${api.base}/**`, (r) => setTimeout(() => r.continue().catch(() => {}), DELAY));
  await page.reload();
  await page.waitForSelector('#secret');
  await page.fill('#secret', PIN);
  const t0 = Date.now();
  await page.click('text=Desbloquear');
  await page.waitForFunction((n) => document.querySelectorAll('.row-btn').length >= n, ROOMS, { timeout: 120_000 });
  const toList = Date.now() - t0;
  // As mensagens novas aparecem (na hora ou logo depois da sincronização).
  await page.waitForFunction(() => /nova \d+/.test(document.querySelector('main')?.textContent ?? ''), null, { timeout: 120_000 });
  const toFresh = Date.now() - t0;
  const m = await marks();
  console.log(JSON.stringify({ toList, toFresh, marks: m }));
  assert.ok(toList < 120_000);
});

test('E3: limpeza de vencidas com cache do prazo continua apagando no prazo', async () => {
  const r = await page.evaluate(async () => {
    const { S } = globalThis.__mpTest;
    const now = S.clock.now();
    const t = async (fn) => { const a = performance.now(); const n = await fn(); return [n, Math.round(performance.now() - a)]; };
    const [, first] = await t(() => S.store.purgeExpired(now));
    const [, second] = await t(() => S.store.purgeExpired(now));
    const base = { room: 'perfroom', sender: S.client.userId, kind: 'text', text: 'vence logo', acceptedAt: now };
    await S.store.putMessage({ ...base, msgId: 'perfexpA', expiresAt: now + 2000 });
    await S.store.putMessage({ ...base, msgId: 'perfexpB', expiresAt: now + 2000 });
    const early = await S.store.purgeExpired(now);
    // B ganhou prazo maior depois (mesmo id): o cache acompanha a gravação.
    await S.store.putMessage({ ...base, msgId: 'perfexpB', expiresAt: now + 86_400_000 });
    const late = await S.store.purgeExpired(now + 3000);
    const a = await S.store.getMessage('perfexpA'), b = await S.store.getMessage('perfexpB');
    await S.store.deleteMessages(['perfexpB']);
    return { first, second, early, late, aGone: a === undefined, bKept: b?.msgId === 'perfexpB' };
  });
  console.log(JSON.stringify(r));
  assert.equal(r.early, 0, 'nada vence antes do prazo');
  assert.equal(r.late, 1, 'só a vencida sai');
  assert.ok(r.aGone && r.bKept);
});
