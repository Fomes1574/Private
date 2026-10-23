// Confere as releases geradas, do jeito que o service worker confere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, createPublicKey, verify } from 'node:crypto';

const web = new URL('../web/', import.meta.url);
const sw = await readFile(new URL('sw.js', web), 'utf8');
const pub = Buffer.from(/const PUBLIC_KEY_B64 = '([^']+)'/.exec(sw)[1], 'base64');
const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pub]), format: 'der', type: 'spki' });
const sha = (b) => createHash('sha256').update(b).digest('hex');

async function check(dir) {
  const base = new URL(`releases/${dir}/`, web);
  const bytes = await readFile(new URL('release.json', base));
  const sig = Buffer.from((await readFile(new URL('release.sig', base), 'utf8')).trim(), 'base64');
  if (!verify(null, bytes, key, sig)) return 'assinatura';
  const m = JSON.parse(bytes);
  for (const [p, h] of Object.entries(m.files)) if (sha(await readFile(new URL(p, base))) !== h) return `hash:${p}`;
  return m.version;
}

test('releases legítimas conferem', async () => {
  assert.equal(await check('v0'), 0);
  assert.equal(await check('v1'), 1);
  assert.equal(await check('v2'), 2);
});

test('releases de teste são recusadas pelo motivo certo', async () => {
  assert.equal(await check('v3-adulterada'), 'hash:app.js');
  assert.equal(await check('v3-outra-chave'), 'assinatura');
});

test('nenhuma chave privada no build', async () => {
  const { readdir } = await import('node:fs/promises');
  const all = await readdir(web, { recursive: true });
  assert.ok(!all.some((f) => /\.(pem|key)$/.test(f)));
  assert.doesNotMatch(sw, /PRIVATE/);
});

test('o service worker não pula a espera', () => {
  assert.doesNotMatch(sw.replace(/\/\/.*$/gm, ''), /skipWaiting\(/);
});
