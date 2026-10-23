import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, startServer, browser, watchErrors } from './helpers.mjs';

let stop, ctx;
before(async () => { stop = await startServer(); ctx = await browser(); });
after(async () => { await ctx?.close(); stop?.(); });

const diag = async (p) => JSON.parse(await p.textContent('#diag'));
async function click(page, sel, label) {
  await page.click(sel);
  await page.waitForFunction((l) => document.querySelector('#status').textContent.startsWith(`${l}: pronto`) || /Falhou/.test(document.querySelector('#status').textContent), label, { timeout: 120000 });
  assert.doesNotMatch(await page.textContent('#status'), /Falhou/);
}

test('prova 3: SQLite no OPFS, cifrado, persiste, vence e some com a chave', async () => {
  let page = await ctx.newPage();
  const errors = watchErrors(page);
  await page.goto(`${BASE}/poc3/`);
  await page.waitForSelector('#app:not([hidden])');
  await click(page, '#fill', 'Gravar 1.000');
  await click(page, '#short', 'Gravar 5 que vencem em 30 s');
  let d = await diag(page);
  assert.equal(d.db.count, 1005);
  assert.equal(d.db.schema, 2);
  assert.equal(d.lastList.shown, 20);

  // "Fechar" o app e voltar depois do prazo curto (relógio do navegador adiantado).
  await page.close();
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.clock.install({ time: Date.now() + 60_000 });
  await page.goto(`${BASE}/poc3/`);
  await page.waitForSelector('#app:not([hidden])');
  await page.waitForFunction(() => /"lastList"/.test(document.querySelector('#diag').textContent));
  d = await diag(page);
  assert.equal(d.opens, 2);
  assert.equal(d.lastList.purgedBeforeRender, 5, 'vencidas apagadas antes de mostrar');
  assert.equal(d.db.count, 1000, 'persistiu no OPFS');
  const first = await page.textContent('#list li');
  assert.match(first, /^mensagem \d+/);

  await click(page, '#shred', 'Destruir a chave');
  const items = await page.$$eval('#list li', (l) => l.map((x) => x.textContent));
  assert.ok(items.length > 0 && items.every((t) => t.startsWith('(ilegível')), 'nada legível sem a chave');

  await click(page, '#wipe', 'Apagar o banco');
  d = await diag(page);
  assert.equal(d.db.count, 0);
  console.log('prova 3:', JSON.stringify(d.db));
  assert.deepEqual(errors, []);
});
