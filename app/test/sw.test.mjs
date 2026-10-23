// Build de produção (service worker + release assinada) no navegador.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { browser, watchErrors } from '../../e2e/helpers.mjs';

const PORT = 8797, APP = `http://localhost:${PORT}`;
let proc, ctx;
before(async () => {
  execFileSync(process.execPath, ['build.mjs'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, MP_MODE: 'sw', MP_API: 'http://127.0.0.1:9' }, stdio: 'ignore' });
  proc = spawn(new URL('../node_modules/.bin/wrangler', import.meta.url).pathname, ['dev', '--local', '--port', String(PORT), '--ip', '127.0.0.1'],
    { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore', detached: true, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(APP + '/')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
  ctx = await browser();
});
after(async () => { await ctx?.close(); try { process.kill(-proc.pid, 'SIGTERM'); } catch {} });

test('instala pela release assinada, abre sem internet e ignora arquivo trocado no servidor', async () => {
  const page = await ctx.newPage();
  const errors = watchErrors(page);
  await page.goto(APP + '/');
  await page.waitForSelector('text=Tenho um convite', { timeout: 30000 });
  assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'servido pelo service worker');

  await page.route('**/main.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'document.body.textContent = "trocado"' }));
  await page.reload();
  await page.waitForSelector('text=Tenho um convite');
  await page.unroute('**/main.js');

  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('text=Tenho um convite');
  await ctx.setOffline(false);
  assert.deepEqual(errors.filter((e) => !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(e)), []);
});
