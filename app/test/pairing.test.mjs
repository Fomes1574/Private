// Troca de celular pela interface, nos dois jeitos de dar errado:
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

const PORT = 8806;
const APP = `http://localhost:${PORT}`;
const PIN = '284917';
const PIN2 = '613058';
const dist = new URL('../dist', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json' };
let api, server, ctxA, ctxB, ctxC, anaId, phoneB;
const PIN3 = '470259';

before(async () => {
  api = await startApi(8807, { appOrigin: APP });
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
// Celular novo pede a troca e mostra pedido/código.
async function requestPair(p, pin) {
  await p.goto(APP);
  await p.click('text=Já uso em outro celular');
  await p.fill('#s1', pin); await p.fill('#s2', pin); await p.click('form button');
  await p.waitForSelector('dd.code.big');
  return p.$$eval('dd.code', (els) => [els[0].textContent, els[1].textContent]);
}
async function unlockWith(p, pin) {
  await p.waitForSelector('#secret');
  await p.fill('#secret', pin);
  await p.click('text=Desbloquear');
}
const vaultOf = (p) => p.evaluate(() => new Promise((ok) => { const r = indexedDB.open('mp-app'); r.onsuccess = () => { const db = r.result; if (!db.objectStoreNames.contains('kv')) { db.close(); return ok(null); } const q = db.transaction('kv').objectStore('kv').get('vault'); q.onsuccess = () => { db.close(); ok(q.result ?? null); }; }; r.onerror = () => ok(null); }));

test('debug antigo aprova e se apaga na hora; novo morto antes da aprovação; a conta sobrevive', async () => {
  let a;
  ({ ctx: ctxA, page: a } = await phone());
  await a.goto(`${APP}/#instalar`);
  await a.click('text=Instalar a primeira pessoa');
  await a.fill('#s1', PIN); await a.fill('#s2', PIN); await a.click('form button');
  await a.fill('#token', SETUP); await a.click('text=Entrar');
  await a.fill('#nick', 'Ana'); await a.click('form button'); await a.waitForSelector('#search');
  anaId = await a.evaluate(() => globalThis.__mpTest.S.client.userId);

  let b;
  ({ ctx: ctxB, page: b } = await phone());
  phoneB = b;
  const [pairingId, code] = await requestPair(b, PIN2);
  // O app novo é fechado antes da aprovação: já guardou tudo.
  await b.reload();
  await b.waitForSelector('#secret');

  // Celular antigo com o código de antes: aprova e se apaga em seguida.
  await a.evaluate(async ([id, c]) => {
    await globalThis.__mpTest.S.client.api.post('/v1/devices/pair/approve', { pairingId: id, code: c.replace(/\D/g, '') });
    await globalThis.__mpTest.wipeEverything();
  }, [pairingId, code]);
  assert.equal(await vaultOf(a), null, 'antigo apagado (como o debug faz)');

  // Novo abre com o PIN e termina a troca: mesma conta, ainda administradora.
  await unlockWith(b, PIN2);
  await b.waitForSelector('#search', { timeout: 30000 });
  const me = await b.evaluate(() => globalThis.__mpTest.S.client.api.get('/v1/me'));
  assert.equal(me.userId, anaId, 'mesma conta');
  assert.equal(me.isAdmin, true, 'continua administradora');
  assert.equal(me.pending, false);
  // Trancar e abrir de novo: segue normal.
  await b.evaluate(() => globalThis.__mpTest.lock('manual'));
  await unlockWith(b, PIN2);
  await b.waitForSelector('#search', { timeout: 30000 });
});

test('código novo: novo morre depois da aprovação; antigo segue valendo e só se apaga quando o novo confirma', async () => {
  const b = phoneB; // agora é o celular "antigo" da Ana
  let c;
  ({ ctx: ctxC, page: c } = await phone());
  let commitBlocked = 0;
  await c.route('**/v1/devices/pair/commit', (r) => { commitBlocked++; r.abort(); });
  const [pairingId, code] = await requestPair(c, PIN3);

  await b.bringToFront();
  if (await b.$('#secret')) { await unlockWith(b, PIN2); await b.waitForSelector('#search', { timeout: 30000 }); }
  await b.click('[aria-label=Ajustes]');
  await b.fill('[aria-label=Pedido]', pairingId);
  await b.fill('[aria-label=Código]', code);
  await b.click('text=Aprovar celular novo');
  await b.click('.sheet button:text-is("Aprovar")');
  await b.waitForFunction(() => /Esperando o celular novo/.test(document.querySelector('#pair-wait')?.textContent ?? ''), null, { timeout: 15000 });

  await c.bringToFront();
  for (let i = 0; i < 100 && !commitBlocked; i++) await c.waitForTimeout(100);
  assert.ok(commitBlocked > 0, 'novo chegou a tentar confirmar');
  await c.reload();
  await c.unroute('**/v1/devices/pair/commit');

  await b.waitForTimeout(4000);
  assert.equal(await b.evaluate(async () => (await globalThis.__mpTest.S.client.api.get('/v1/me')).userId), anaId, 'antigo ainda vale');
  assert.ok(await vaultOf(b), 'antigo não apagou nada');

  await unlockWith(c, PIN3);
  await c.waitForSelector('#search', { timeout: 30000 });
  const me = await c.evaluate(() => globalThis.__mpTest.S.client.api.get('/v1/me'));
  assert.equal(me.userId, anaId);
  assert.equal(me.isAdmin, true);

  await b.waitForFunction(() => /Tenho um convite|Instalar a primeira pessoa/.test(document.body.innerText), null, { timeout: 20000 });
  assert.equal(await vaultOf(b), null, 'só agora o antigo se apagou');
});
