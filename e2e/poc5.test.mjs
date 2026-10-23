// Só roda contra o Worker de deploy (E2E_BASE), que serve a página e a API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, browser, watchErrors } from './helpers.mjs';

const enabled = !!process.env.E2E_BASE && !!process.env.PROVA_ACCESS_CODE;
let ctx;
before(async () => { if (enabled) ctx = await browser(); });
after(async () => { await ctx?.close(); });

test('prova 5: segurar para ver, uma vez por destinatário', { skip: !enabled && 'precisa de E2E_BASE e PROVA_ACCESS_CODE' }, async () => {
  const page = await ctx.newPage();
  const errors = watchErrors(page);
  await page.goto(`${BASE}/poc5/`);
  await page.waitForSelector('#app:not([hidden])');
  await page.fill('#code', process.env.PROVA_ACCESS_CODE);
  await page.setInputFiles('#file', new URL('../poc/05-ver-uma-vez/web/icon-512.png', import.meta.url).pathname);
  await page.click('#send');
  await page.waitForFunction(() => /Enviada/.test(document.querySelector('#status').textContent));
  assert.match(await page.textContent('#status'), /Brasília/);
  const hold = async (who) => {
    const box = await (await page.$(`[data-who=${who}] .hold`)).boundingBox();
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.mouse.down();
    await page.waitForFunction((w) => document.querySelector(`[data-who=${w}] .state`).textContent !== '', who);
    const shown = await page.isVisible('#viewer');
    await page.mouse.up();
    await page.waitForTimeout(50);
    return { shown, hiddenAfter: !(await page.isVisible('#viewer')), state: await page.textContent(`[data-who=${who}] .state`) };
  };
  const b1 = await hold('bia');
  assert.deepEqual([b1.shown, b1.hiddenAfter], [true, true]);
  await page.evaluate(() => { for (const s of document.querySelectorAll('.state')) s.textContent = ''; });
  assert.match((await hold('bia')).state, /Já vista/);
  assert.match((await hold('ana')).state, /Quem enviou/);
  assert.equal((await hold('caio')).shown, true);
  assert.deepEqual(errors.filter((e) => !/status of (403|410)/.test(e)), []);
});
