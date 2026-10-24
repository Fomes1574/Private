// Botão de notificações: nunca fica calado. Testa os dois caminhos:
// - web sem service worker (como o navegador comum): "Erro" com explicação;
// - Android, com um plugin NovasMensagens FALSO no lugar do nativo: aguardando
//   permissão → ativado; desativar; recusado; erro do serviço; permissão
//   retirada nas configurações (descoberta no desbloqueio); apagar tudo.
// O FCM de verdade e o aparelho de verdade ficam para o teste em celular
// (docs/TESTE_EM_CELULAR.md). Isto aqui é simulação e não aprova nada sozinho.
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

const stateText = () => page.textContent('#push-state');
async function waitState(s) { await page.waitForFunction((x) => document.querySelector('#push-state')?.dataset.state === x, s, { timeout: 15000 }); }
async function openSettings() {
  if (await page.$('[aria-label=Voltar]')) await page.click('[aria-label=Voltar]');
  await page.click('[aria-label=Ajustes]');
  await page.waitForSelector('#push-state');
}
// Plugin nativo falso: o teste decide a permissão e o resultado do token.
const installFake = () => page.evaluate(() => {
  const f = globalThis.__fake = { permission: 'prompt', configured: true, answer: null, tokenFails: false, unregistered: 0 };
  globalThis.Capacitor = { isNativePlatform: () => true, Plugins: { NovasMensagens: {
    status: async () => ({ configured: f.configured, permission: f.permission }),
    requestPermission: () => new Promise((ok) => { f.answer = (p) => { f.permission = p; ok({ configured: true, permission: p }); }; }),
    token: async () => { if (f.tokenFails) throw new Error('SERVICE_NOT_AVAILABLE'); return { token: `teste:${'a'.repeat(140)}` }; },
    unregister: async () => { f.unregistered++; },
  } } };
});
const fake = () => page.evaluate(() => ({ ...globalThis.__fake, answer: undefined }));

test('notificações: estados visíveis no navegador e no Android (plugin simulado)', async () => {
  ctx = await browser(); page = await ctx.newPage(); await virtualAuthenticator(page);
  page.on('request', (r) => { if (r.url().endsWith('/v1/push') && r.method() === 'POST') posts.push(JSON.parse(r.postData())); });
  await page.goto(`${APP}/#instalar`);
  await page.click('text=Instalar a primeira pessoa');
  await page.fill('#s1', PIN); await page.fill('#s2', PIN); await page.click('form button');
  await page.fill('#token', SETUP); await page.click('text=Entrar');
  await page.fill('#nick', 'Ana'); await page.click('form button'); await page.waitForSelector('#search');

  // Navegador sem service worker: erro explicado, nunca silêncio.
  await openSettings();
  await waitState('unavailable');
  assert.match(await stateText(), /^Este navegador não oferece notificações aqui\./, 'indisponível explica, sem chamar de erro');
  assert.equal(await page.textContent('#push-btn'), 'Tentar de novo');

  // APK sem Firebase (o atual): explica que no Android não há aviso com o app fechado.
  await page.evaluate(() => { globalThis.Capacitor = { isNativePlatform: () => true, Plugins: {} }; });
  await openSettings();
  await waitState('unavailable');
  assert.match(await stateText(), /não usa serviços do Google/);

  // Android com o plugin (APK futuro, simulado): aguardando permissão → ativado.
  await installFake();
  await openSettings();
  await waitState('off');
  assert.equal(await page.textContent('#push-btn'), 'Ativar notificações');
  posts.length = 0;
  await page.click('#push-btn');
  await waitState('waiting');
  assert.match(await stateText(), /Aguardando permissão/);
  assert.equal(await page.isDisabled('#push-btn'), true);
  await page.evaluate(() => globalThis.__fake.answer('granted'));
  await waitState('on');
  assert.equal(await page.textContent('#push-btn'), 'Desativar notificações');
  assert.deepEqual(posts, [{ fcm: `teste:${'a'.repeat(140)}` }], 'só o token deste aparelho vai ao servidor');

  // Desativar: o servidor esquece e o token é apagado no aparelho.
  posts.length = 0;
  await page.click('#push-btn');
  await waitState('off');
  assert.deepEqual(posts, [{ endpoint: null }]);
  assert.equal((await fake()).unregistered, 1);

  // Recusado.
  await page.evaluate(() => { globalThis.__fake.permission = 'prompt'; });
  await page.click('#push-btn');
  await waitState('waiting');
  await page.evaluate(() => globalThis.__fake.answer('denied'));
  await waitState('denied');
  assert.match(await stateText(), /^Recusadas\./);
  assert.equal(await page.textContent('#push-btn'), 'Tentar de novo');

  // Erro do serviço de notificações.
  await page.evaluate(() => { globalThis.__fake.permission = 'granted'; globalThis.__fake.tokenFails = true; });
  await page.click('#push-btn');
  await waitState('error');
  assert.match(await stateText(), /^Erro: Não deu para registrar: .*SERVICE_NOT_AVAILABLE/);

  // Ativado e, depois, permissão retirada nas configurações do Android: no
  // próximo desbloqueio o servidor esquece o destino e a tela diz "Recusadas".
  await page.evaluate(() => { globalThis.__fake.tokenFails = false; });
  await page.click('#push-btn');
  await waitState('on');
  await page.evaluate(() => { globalThis.__fake.permission = 'denied'; });
  posts.length = 0;
  await page.evaluate(() => globalThis.__mpTest.lock('manual'));
  await page.waitForSelector('#secret');
  await page.fill('#secret', PIN);
  await page.click('text=Desbloquear');
  await page.waitForSelector('#search', { timeout: 30000 });
  for (let i = 0; i < 50 && !posts.length; i++) await page.waitForTimeout(100);
  assert.deepEqual(posts, [{ endpoint: null }], 'permissão retirada: servidor esquece');
  await openSettings();
  await waitState('denied');

  // Apagar tudo: o token do aparelho também some.
  const before = (await fake()).unregistered;
  await page.click('text=Apagar tudo deste aparelho');
  await page.click('.sheet >> text=Apagar tudo');
  await page.waitForFunction((n) => globalThis.__fake.unregistered > n, before, { timeout: 15000 });
});
