import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, startServer, browser, watchErrors, virtualAuthenticator } from './helpers.mjs';

let stop, ctx;
before(async () => { stop = await startServer(); ctx = await browser(); });
after(async () => { await ctx?.close(); stop?.(); });

const status = (p) => p.textContent('#status');

test('prova 2: cofre com passkey PRF + PIN', async () => {
  const page = await ctx.newPage();
  const errors = watchErrors(page);
  await virtualAuthenticator(page);
  await page.goto(`${BASE}/poc2/`);
  await page.waitForSelector('#setup:not([hidden])');

  // PIN fraco é recusado antes de qualquer passkey.
  await page.fill('#secret1', '123456'); await page.fill('#secret2', '123456');
  await page.click('#createBtn');
  assert.match(await status(page), /sequência/);

  await page.fill('#secret1', '284917'); await page.fill('#secret2', '284917');
  await page.click('#createBtn');
  await page.waitForSelector('#unlocked:not([hidden])', { timeout: 30000 });
  await page.fill('#note', 'nota secreta'); await page.click('#noteForm button');
  await page.waitForFunction(() => document.querySelector('#noteShown').textContent === 'nota secreta');

  // Bloquear e errar o PIN.
  await page.click('#lockBtn');
  await page.fill('#unlockSecret', '999999'); await page.click('#unlockForm button');
  await page.waitForFunction(() => /1 de 5/.test(document.querySelector('#attempts').textContent), null, { timeout: 30000 });

  // Recarregar (fechar e abrir) e acertar: a nota volta e o contador zera.
  await page.reload();
  await page.waitForSelector('#locked:not([hidden])');
  assert.equal(await page.textContent('#noteShown'), '', 'nada aparece antes do desbloqueio');
  await page.fill('#unlockSecret', '284917'); await page.click('#unlockForm button');
  await page.waitForFunction(() => document.querySelector('#noteShown').textContent === 'nota secreta', null, { timeout: 30000 });

  // Cinco erros destroem o cofre.
  await page.click('#lockBtn');
  for (let i = 0; i < 5; i++) {
    await page.fill('#unlockSecret', '999999'); await page.click('#unlockForm button');
    await page.waitForFunction((n) => document.querySelector('#diag').textContent.split('segredo errado').length - 1 >= n
      || /destruído/.test(document.querySelector('#attempts').textContent), i + 1, { timeout: 30000 });
  }
  assert.match(await page.textContent('#attempts'), /destruído/);
  await page.fill('#unlockSecret', '284917'); await page.click('#unlockForm button');
  await page.waitForTimeout(500);
  assert.match(await page.textContent('#attempts'), /destruído/, 'nem o PIN certo abre');

  const d = JSON.parse(await page.textContent('#diag'));
  console.log('prova 2:', JSON.stringify({ argon2idMs: d.argon2idMs, prfAtCreate: d.prfReturnedAtCreate, caps: d.capabilities }));
  assert.deepEqual(errors, []);
});

test('prova 2: sem PRF o modo passkey falha de forma clara', async () => {
  const fresh = await browser();
  const page = await fresh.newPage();
  await virtualAuthenticator(page, { prf: false });
  await page.goto(`${BASE}/poc2/`);
  await page.waitForSelector('#setup:not([hidden])');
  await page.fill('#secret1', '284917'); await page.fill('#secret2', '284917');
  await page.click('#createBtn');
  await page.waitForFunction(() => /Não deu para criar/.test(document.querySelector('#status').textContent), null, { timeout: 30000 });
  assert.match(await status(page), /PRF/);
  await fresh.close();
});
