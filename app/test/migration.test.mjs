// Atualização sem perda: instala com o código ANTIGO (cofre v1, banco no
// esquema 1, commit 3fa1985), recebe uma mensagem, troca para o código NOVO
// na MESMA origem e recarrega. Identidade, conversa e mensagem continuam; o
// cofre vira v2 (parte do servidor) e o banco vira esquema 2 (sem metadado
// em claro), sem apagar nada no caminho.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { startApi, SETUP } from '../../server/test/helpers.mjs';
import { browser, virtualAuthenticator } from '../../e2e/helpers.mjs';
import { loadCrypto } from '../../packages/crypto/index.js';
import { TrustedClock } from '../../packages/protocol/src/time.js';
import { MessengerClient, Api, MemoryStore } from '../../packages/client/src/index.js';

const OLD_COMMIT = '3fa1985'; // último com cofre v1 e banco esquema 1
const PORT = 8802;
const APP = `http://localhost:${PORT}`;
const PIN = '284917';
const repo = new URL('../..', import.meta.url).pathname;
let api, server, root, oldDir, ctx, page;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json' };
function serve() {
  return createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, APP).pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = path.endsWith('/') ? `${path}index.html` : path;
    try {
      const body = await readFile(join(root, file));
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  }).listen(PORT, '127.0.0.1');
}
const build = (dir) => execFileSync(process.execPath, ['build.mjs'], { cwd: dir, env: { ...process.env, MP_MODE: 'plain', MP_API: api.base, MP_TEST_HOOKS: '1' }, stdio: 'ignore' });
const vaultRecord = () => page.evaluate(() => new Promise((ok) => {
  const r = indexedDB.open('mp-app'); r.onsuccess = () => { const q = r.result.transaction('kv').objectStore('kv').get('vault'); q.onsuccess = () => { r.result.close(); ok(q.result); }; };
}));

before(async () => {
  api = await startApi(8803, { appOrigin: APP });
  oldDir = process.env.MP_MIGRATION_OLD_DIR || join(await mkdtemp(join(tmpdir(), 'mp-old-')), 'repo');
  if (!process.env.MP_MIGRATION_OLD_DIR) execFileSync('git', ['worktree', 'add', '--detach', oldDir, OLD_COMMIT], { cwd: repo, stdio: 'ignore' });
  build(join(oldDir, 'app'));
  build(join(repo, 'app'));
  root = join(oldDir, 'app/dist');
  server = serve();
  await loadCrypto(await readFile(new URL('../../packages/crypto/pkg/mp_crypto_bg.wasm', import.meta.url)));
});
after(async () => {
  await ctx?.close(); server?.close(); api?.stop();
  try { if (!process.env.MP_MIGRATION_OLD_DIR) execFileSync('git', ['worktree', 'remove', '--force', oldDir], { cwd: repo, stdio: 'ignore' }); } catch {}
});

test('código antigo → código novo: identidade, conversa e mensagem preservadas; cofre e banco migrados', async () => {
  ctx = await browser(); page = await ctx.newPage(); await virtualAuthenticator(page);
  // 1) Código antigo: administradora instala e recebe uma mensagem.
  await page.goto(`${APP}/#instalar`);
  await page.click('text=Instalar a primeira pessoa');
  await page.fill('#s1', PIN); await page.fill('#s2', PIN); await page.click('form button');
  await page.fill('#token', SETUP); await page.click('text=Entrar');
  await page.fill('#nick', 'Ana'); await page.click('form button'); await page.waitForSelector('#search');
  const old = await vaultRecord();
  assert.equal(old.v, 1, 'instalado com o cofre antigo');
  const { token, anaId } = await page.evaluate(async () => ({ token: (await globalThis.__mpTest.S.client.api.post('/v1/invites', {})).token, anaId: globalThis.__mpTest.S.client.userId }));

  const bia = new MessengerClient({ api: new Api(api.base, new TrustedClock()), store: new MemoryStore(), pickleKey: crypto.getRandomValues(new Uint8Array(32)) });
  await bia.redeem(token); await bia.login(); await bia.refreshDirectory();
  const room = (await bia.createRoom('direct', [anaId])).roomId;
  await bia.sendText(room, 'mensagem de antes da atualização');
  await page.evaluate(() => globalThis.__mpTest.syncNow());
  assert.equal(await page.evaluate(async (r) => (await globalThis.__mpTest.S.client.view(r)).render.at(-1)?.text, room), 'mensagem de antes da atualização');

  // 2) Atualização: mesmo endereço, código novo. Recarrega e desbloqueia.
  root = join(repo, 'app/dist');
  await page.reload();
  await page.waitForSelector('#secret');
  await page.fill('#secret', PIN);
  await page.click('text=Desbloquear');
  await page.waitForSelector('#search', { timeout: 30000 });
  const nv = await vaultRecord();
  assert.equal(nv.v, 2, 'cofre migrado para v2');
  assert.ok(nv.vaultId, 'parte do servidor registrada');
  assert.equal(await page.evaluate(() => globalThis.__mpTest.S.client.userId), anaId, 'mesma identidade');
  await page.click('.row-btn .title');
  await page.waitForSelector('.msg >> text=mensagem de antes da atualização');

  // 3) Banco convertido: cópia crua sem o texto nem o id da conversa.
  const scan = await page.evaluate(async (needles) => {
    const dec = new TextDecoder('latin1'); const found = new Set();
    async function walk(d) { for await (const [, h] of d.entries()) { if (h.kind === 'directory') await walk(h); else { const t = dec.decode(await (await h.getFile()).arrayBuffer()); for (const n of needles) if (t.includes(n)) found.add(n); } } }
    await walk(await navigator.storage.getDirectory());
    return [...found];
  }, [room, 'mensagem de antes']);
  // O arquivo antigo é refeito pela rotação (até ~15 s depois de migrar).
  await page.waitForTimeout(17000);
  const after = await page.evaluate(async (needles) => {
    const dec = new TextDecoder('latin1'); const found = new Set();
    async function walk(d) { for await (const [, h] of d.entries()) { if (h.kind === 'directory') await walk(h); else { const t = dec.decode(await (await h.getFile()).arrayBuffer()); for (const n of needles) if (t.includes(n)) found.add(n); } } }
    await walk(await navigator.storage.getDirectory());
    return [...found];
  }, [room, 'mensagem de antes']);
  assert.deepEqual(after, [], `nada em claro depois da rotação (antes dela: ${scan})`);

  // 4) Já no formato novo: trancar e abrir de novo passa pelo servidor.
  await page.evaluate(() => globalThis.__mpTest.lock('manual'));
  await page.waitForSelector('#secret');
  await page.fill('#secret', PIN);
  await page.click('text=Desbloquear');
  await page.click('.row-btn .title');
  await page.waitForSelector('.msg >> text=mensagem de antes da atualização');
  await bia.sendText(room, 'e depois também');
  await page.waitForSelector('.msg >> text=e depois também', { timeout: 40000 });
});
