// D15: o app não tem mais notificações. Os Ajustes não mostram a seção, e um
// aparelho que tinha ligado (APK com plugin NovasMensagens FALSO no lugar do
// nativo) é desligado no desbloqueio: o servidor esquece o destino e o token
// do aparelho é apagado. "Apagar tudo" também apaga o token.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { startApi, SETUP } from '../../server/test/helpers.mjs';
import { browser, virtualAuthenticator } from '../../e2e/helpers.mjs';

const PORT = 8804;
const APP = `http://localhost:${PORT}`;
const PIN = '284917';
const dist = new URL('../dist', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json' };
let api, server, ctx, page;
const posts = [];

before(async () => {
  api = await startApi(8805, { appOrigin: APP });
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

// Plugin nativo falso: conta quantas vezes o token foi apagado.
const installFake = () => page.evaluate(() => {
  const f = globalThis.__fake = { permission: 'granted', configured: true, unregistered: 0 };
  globalThis.Capacitor = { isNativePlatform: () => true, Plugins: { NovasMensagens: {
    status: async () => ({ configured: f.configured, permission: f.permission }),
    requestPermission: async () => ({ configured: true, permission: f.permission }),
    token: async () => ({ token: `teste:${'a'.repeat(140)}` }),
    unregister: async () => { f.unregistered++; },
  } } };
});
const fake = () => page.evaluate(() => ({ ...globalThis.__fake }));

test('D15: sem seção de notificações; quem tinha ligado é desligado no desbloqueio', async () => {
  ctx = await browser(); page = await ctx.newPage(); await virtualAuthenticator(page);
  page.on('request', (r) => { if (r.url().endsWith('/v1/push') && r.method() === 'POST') posts.push(JSON.parse(r.postData())); });
  await page.goto(`${APP}/#instalar`);
  await page.click('text=Instalar a primeira pessoa');
  await page.fill('#s1', PIN); await page.fill('#s2', PIN); await page.click('form button');
  await page.fill('#token', SETUP); await page.click('text=Entrar');
  await page.fill('#nick', 'Ana'); await page.click('form button'); await page.waitForSelector('#search');

  await page.click('[aria-label=Ajustes]');
  await page.waitForSelector('text=Trocar de celular');
  assert.equal(await page.$('#push-state'), null);
  assert.equal(await page.$('h2:text-is("Notificações")'), null);
  assert.equal(await page.$('h2:text-is("Guardião")'), null);
  assert.equal(await page.$('#show-preview'), null, 'prévia na lista é obrigatória');
  assert.equal(await page.$('text=Fotos íntimas'), null);
  await page.click('[aria-label=Voltar]');

  // Aparelho antigo com notificações ligadas: no desbloqueio, tudo desliga.
  await installFake();
  await page.evaluate(() => globalThis.__mpTest.setPrefs({ push: true }));
  posts.length = 0;
  await page.evaluate(() => globalThis.__mpTest.lock('manual'));
  await page.waitForSelector('#secret');
  await page.fill('#secret', PIN);
  await page.click('text=Desbloquear');
  await page.waitForSelector('#search', { timeout: 30000 });
  await page.waitForFunction(() => globalThis.__fake.unregistered > 0, null, { timeout: 15000 });
  assert.deepEqual(posts, [{ endpoint: null }], 'servidor esquece o destino');
  assert.equal(await page.evaluate(() => globalThis.__mpTest.pushEnabled()), false);

  // Apagar tudo: o token do aparelho também some.
  const before = (await fake()).unregistered;
  await page.click('[aria-label=Ajustes]');
  await page.click('text=Apagar tudo deste aparelho');
  await page.click('.sheet >> text=Apagar tudo');
  await page.waitForFunction((n) => globalThis.__fake.unregistered > n, before, { timeout: 15000 });
});
