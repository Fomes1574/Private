// Migração S12 no app/SQLite/IndexedDB reais, inclusive queda antes/depois
// da troca durável. Nenhum rollback pode deixar cofre e banco divergentes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { startApi, SETUP } from '../../server/test/helpers.mjs';
import { browser, virtualAuthenticator } from '../../e2e/helpers.mjs';

const APP = 'http://localhost:8912', PIN = '284917';
const root = new URL('../dist/', import.meta.url).pathname;
let api, server, ctx, page;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };
before(async () => {
  api = await startApi(8913, { appOrigin: APP });
  execFileSync(process.execPath, ['build.mjs'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, MP_MODE: 'plain', MP_API: api.base, MP_TEST_HOOKS: '1' }, stdio: 'ignore' });
  server = createServer(async (req, res) => {
    try { const path = new URL(req.url, APP).pathname, data = await readFile(join(root, path === '/' ? 'index.html' : path)); res.writeHead(200, { 'content-type': types[extname(path)] ?? (path === '/' ? 'text/html' : 'application/octet-stream'), 'cache-control': 'no-store' }); res.end(data); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise((r) => server.listen(8912, '127.0.0.1', r));
  ctx = await browser(); page = await ctx.newPage(); await virtualAuthenticator(page);
  await page.goto(`${APP}/#instalar`); await page.click('text=Instalar a primeira pessoa');
  await page.fill('#s1', PIN); await page.fill('#s2', PIN); await page.click('form button');
  await page.fill('#token', SETUP); await page.click('text=Entrar');
  await page.fill('#nick', 'Ana'); await page.click('form button'); await page.waitForSelector('#search');
  await page.evaluate(() => globalThis.__mpTest.addNote('nota preservada pela migração', 86400));
});
after(async () => { await ctx?.close(); api?.stop(); await new Promise((r) => server?.close(r)); });
async function legacy() {
  return page.evaluate(async () => {
    const { S, vaultStore } = globalThis.__mpTest, old = await vaultStore.load();
    await S.client.api.post('/__test/vault/legacy', { vaultId: old.vaultId });
    return { record: old, token: S.client.api.token, pool: await (await import('/idb.js')).idbGet('activePool') };
  });
}
const unlock = () => page.evaluate(async (pin) => { try { await globalThis.__mpTest.unlock(pin); return { ok: true }; } catch (e) { return { ok: false, error: e.name, unlocked: globalThis.__mpTest.S.unlocked }; } }, PIN);
const lock = () => page.evaluate(() => globalThis.__mpTest.lock('manual'));

test('R01: falha síncrona no último put aborta TODOS os registros e permite retomar sem perda', async () => {
  const old = await legacy(); await lock();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put; window.savedMigrationPut = put;
    IDBObjectStore.prototype.put = function (value, key) { if (key === 'shareMigration') { IDBObjectStore.prototype.put = put; throw new DOMException('falha sintética', 'DataCloneError'); } return put.call(this, value, key); };
  });
  const failure = await unlock(); assert.equal(failure.ok, false); assert.equal(failure.unlocked, false);
  const unchanged = await page.evaluate(async () => { const { idbGet } = await import('/idb.js'); return { record: await idbGet('vault'), pool: await idbGet('activePool') }; });
  assert.equal(unchanged.record.vaultId, old.record.vaultId); assert.equal(unchanged.pool, old.pool);
  assert.equal((await unlock()).ok, true);
  const current = await page.evaluate(async () => ({ record: await globalThis.__mpTest.vaultStore.load(), notes: await globalThis.__mpTest.notes() }));
  assert.notEqual(current.record.vaultId, old.record.vaultId);
  assert.equal(current.notes[0].text, 'nota preservada pela migração');
});

test('R01: commit remoto indisponível mantém marcador; próximo desbloqueio conclui sem remigrar', async () => {
  const old = await legacy(); await lock();
  await page.route('**/v1/vault/migrate/commit', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"temporarily_unavailable"}', headers: { 'access-control-allow-origin': APP } }));
  assert.equal((await unlock()).ok, true);
  const pending = await page.evaluate(async () => { const { idbGet } = await import('/idb.js'); return { record: await idbGet('vault'), marker: await idbGet('shareMigration') }; });
  assert.notEqual(pending.record.vaultId, old.record.vaultId); assert.equal(pending.marker.previous, old.record.vaultId);
  await lock(); await page.unroute('**/v1/vault/migrate/commit');
  assert.equal((await unlock()).ok, true);
  const done = await page.evaluate(async () => { const { idbGet } = await import('/idb.js'); return { record: await idbGet('vault'), marker: await idbGet('shareMigration'), notes: await globalThis.__mpTest.notes() }; });
  assert.equal(done.record.vaultId, pending.record.vaultId); assert.equal(done.marker, null);
  assert.equal(done.notes[0].text, 'nota preservada pela migração');
  const r = await fetch(`${api.base}/v1/vault/migrate/prepare`, { method: 'POST', headers: { authorization: `Bearer ${old.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ vaultId: old.record.vaultId }) });
  assert.equal(r.status, 404, 'registro antigo foi retirado após o commit');
});
