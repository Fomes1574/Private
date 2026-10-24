// Recuperação da administradora pelo código de instalação (R-01), pela
// interface: o celular dela sumiu (app desinstalado); num aparelho novo,
// "Administradora: instalar ou recuperar" + código → mesma conta, ainda
// administradora; o aparelho antigo deixa de valer.
// (Cabeçalho herdado do teste de troca de celular:)
// 1) celular antigo com o código ANTIGO (o APK de debug instalado), que se
//    apaga logo depois de aprovar, e celular novo "morto" (recarregado) antes
//    mesmo da aprovação. A conta não pode se perder: o novo já guardou tudo
//    ao mostrar o código e, ao abrir com o PIN, termina sozinho.
// 2) código novo dos dois lados: o novo morre depois da aprovação; o antigo
//    segue funcionando e só se apaga quando o novo confirmar.
// É o caminho da administradora do debug para o APK de distribuição
// (docs/MIGRAR_DEBUG_PARA_RELEASE.md).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { startApi, SETUP } from '../../server/test/helpers.mjs';
import { browser, virtualAuthenticator } from '../../e2e/helpers.mjs';

const PORT = 8808;
const APP = `http://localhost:${PORT}`;
const PIN = '284917';
const PIN2 = '613058';
const dist = new URL('../dist', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json' };
let api, server, ctxA, ctxB, ctxC, anaId, phoneB;
const PIN3 = '470259';

before(async () => {
  api = await startApi(8809, { appOrigin: APP });
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
after(async () => { await ctxA?.close(); await ctxB?.close(); await ctxC?.close(); server?.close(); api?.stop(); });

async function phone() {
  const ctx = await browser(); const page = await ctx.newPage(); await virtualAuthenticator(page);
  return { ctx, page };
}

test('administradora recupera a conta num aparelho novo com o código de instalação', async () => {
  let a;
  ({ ctx: ctxA, page: a } = await phone());
  await a.goto(`${APP}/#instalar`);
  await a.click('text=Instalar a primeira pessoa');
  await a.fill('#s1', PIN); await a.fill('#s2', PIN); await a.click('form button');
  await a.fill('#token', SETUP); await a.click('text=Entrar');
  await a.fill('#nick', 'Ana'); await a.click('form button'); await a.waitForSelector('#search');
  anaId = await a.evaluate(() => globalThis.__mpTest.S.client.userId);

  // Celular novo (o antigo "foi desinstalado"): código errado não passa.
  let b;
  ({ ctx: ctxB, page: b } = await phone());
  await b.goto(APP);
  await b.click('text=Administradora: instalar ou recuperar');
  await b.fill('#s1', PIN2); await b.fill('#s2', PIN2); await b.click('form button');
  await b.fill('#token', 'codigo-errado-0000000000'); await b.click('text=Entrar');
  await b.waitForFunction(() => /Não deu|inválido/.test(document.querySelector('#toast')?.textContent ?? ''));
  assert.equal(await b.$('.sheet'), null, 'sem o código certo nem pergunta');

  // Código certo: o círculo já existe → pergunta → recupera.
  await b.fill('#token', SETUP); await b.click('text=Entrar');
  await b.waitForSelector('.sheet >> text=O círculo já existe');
  await b.click('.sheet button:text-is("Recuperar")');
  await b.waitForSelector('#nick', { timeout: 30000 });
  await b.fill('#nick', 'Ana'); await b.click('form button'); await b.waitForSelector('#search');
  const me = await b.evaluate(() => globalThis.__mpTest.S.client.api.get('/v1/me'));
  assert.equal(me.userId, anaId, 'mesma conta');
  assert.equal(me.isAdmin, true, 'continua administradora');
  // O aparelho antigo não vale mais.
  const old = await a.evaluate(async () => { try { await globalThis.__mpTest.S.client.api.get('/v1/me'); return 200; } catch (e) { return e.status; } });
  assert.equal(old, 401);
  // Fecha e abre de novo com o PIN: segue administradora.
  await b.evaluate(() => globalThis.__mpTest.lock('manual'));
  await b.waitForSelector('#secret'); await b.fill('#secret', PIN2); await b.click('text=Desbloquear');
  await b.waitForSelector('#search', { timeout: 30000 });
});
