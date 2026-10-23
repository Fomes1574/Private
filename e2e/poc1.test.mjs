import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, startServer, browser, watchErrors } from './helpers.mjs';

let stop, ctx;
before(async () => { stop = await startServer(); ctx = await browser(); });
after(async () => { await ctx?.close(); stop?.(); });

test('prova 1: troca, fila offline, fechar e reabrir, segunda aba barrada', async () => {
  let page = await ctx.newPage();
  const errors = watchErrors(page);
  await page.goto(`${BASE}/poc1/`);
  await page.waitForSelector('#app:not([hidden])');
  const say = async (who, t) => {
    await page.fill(`[data-who=${who}] input[name=text]`, t);
    await page.click(`[data-who=${who}] form button`);
    await page.waitForTimeout(100);
  };
  await say('alice', 'olá bob');
  await say('bob', 'olá alice');
  await page.check('#bobOffline');
  await say('alice', 'fila 1');
  await say('alice', 'fila 2');
  assert.equal(await page.textContent('#queued'), '2');

  const second = await ctx.newPage();
  await second.goto(`${BASE}/poc1/`);
  await second.waitForFunction(() => /já está aberto/.test(document.querySelector('#status').textContent));
  await second.close();

  await page.close();
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/poc1/`);
  await page.waitForSelector('#app:not([hidden])');
  await page.click('#deliver');
  await page.waitForTimeout(200);
  const bobLog = await page.$$eval('[data-who=bob] .log li', (l) => l.map((x) => x.firstChild.textContent));
  assert.ok(bobLog.includes('fila 1') && bobLog.includes('fila 2'));
  await say('bob', 'recebi');
  const aliceLog = await page.$$eval('[data-who=alice] .log li', (l) => l.map((x) => x.firstChild.textContent));
  assert.ok(aliceLog.includes('recebi'));

  await page.click('#selftest');
  await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Testes'), null, { timeout: 60000 });
  assert.equal(await page.textContent('#status'), 'Testes: 7/7 ok');
  const d = JSON.parse(await page.textContent('#diag'));
  assert.equal(d.identitiesSameAsFirstOpen, true);
  assert.equal(d.opens, 2);
  assert.deepEqual(errors, []);
});
