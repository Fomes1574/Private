import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, startServer, browser, watchErrors } from './helpers.mjs';

let stop, ctx;
before(async () => { stop = await startServer(); ctx = await browser(); });
after(async () => { await ctx?.close(); stop?.(); });

const diag = async (p) => JSON.parse(await p.textContent('#diag'));
async function check(page, channel) {
  await page.selectOption('#channel', channel);
  await page.click('#check');
  await page.waitForFunction(() => !/Baixando/.test(document.querySelector('#status').textContent), null, { timeout: 30000 });
  return page.textContent('#status');
}

test('prova 4: versão fixada, assinatura, anti-downgrade e atualização com aceite', async () => {
  const page = await ctx.newPage();
  const errors = watchErrors(page);
  await page.goto(`${BASE}/poc4/`);
  await page.waitForFunction(() => document.querySelector('#ver')?.textContent === '1', null, { timeout: 30000 });
  await page.waitForFunction(() => /Rodando/.test(document.querySelector('#status').textContent));
  const d1 = await diag(page);
  assert.equal(d1.pinned.version, 1);
  assert.equal(d1.identityWorks, true);

  for (const ch of ['adulterada', 'assinatura', 'downgrade', 'repetida']) {
    const s = await check(page, ch);
    assert.match(s, /recusada/, `canal ${ch} deveria ser recusado: ${s}`);
  }
  assert.equal(await page.isHidden('#offer'), true);

  // Mesmo que o servidor passe a servir outro app.js, a versão fixada não muda.
  await page.route('**/poc4/app.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'document.title="trocado"' }));
  await page.reload();
  await page.waitForFunction(() => /Rodando/.test(document.querySelector('#status').textContent));
  assert.notEqual(await page.title(), 'trocado');
  await page.unroute('**/poc4/app.js');

  const s = await check(page, 'estavel');
  assert.match(s, /pronta/);
  const code = await page.textContent('#offerCode');
  assert.match(code, /^[0-9a-f]{4} [0-9a-f]{4}$/);
  assert.equal(await page.textContent('#ver'), '1', 'nada muda antes do aceite');

  await page.click('#apply');
  await page.waitForFunction(() => document.querySelector('#ver')?.textContent === '2', null, { timeout: 30000 });
  await page.waitForFunction(() => /Rodando/.test(document.querySelector('#status').textContent));
  const d2 = await diag(page);
  assert.equal(d2.identity, d1.identity, 'mesma identidade depois da atualização');
  assert.equal(d2.identityWorks, true, 'chave privada continua utilizável');
  assert.equal(d2.schema, 2);
  assert.equal(d2.pinned.code.slice(0, 4) + ' ' + d2.pinned.code.slice(4), code);

  // Depois de aceitar a v2, a v1 virou downgrade.
  assert.match(await check(page, 'repetida'), /recusada/);

  // Sem internet o app abre na versão fixada.
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#ver')?.textContent === '2');
  await ctx.setOffline(false);
  console.log('prova 4:', JSON.stringify({ v1: d1.pinned.code, v2: d2.pinned.code }));
  assert.deepEqual(errors.filter((e) => !/Failed to load resource/.test(e)), []);
});
