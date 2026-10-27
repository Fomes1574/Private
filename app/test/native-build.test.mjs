import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const build = (flags) => execFileSync(process.execPath, ['build.mjs'], { cwd: root, env: { ...process.env, MP_MODE: 'plain', MP_RELEASE_KEY: '', MP_NATIVE_RELEASE: '', MP_TEST_HOOKS: '', MP_CSP_META: '', MP_API: 'https://api.invalid', ...flags }, stdio: 'pipe' });
const config = async () => JSON.parse(/Object\.freeze\((\{[^\n]*\})\);/.exec(await readFile(new URL('../dist/config.js', import.meta.url), 'utf8'))[1]);

test('APK de produção usa assinatura nativa sem chave da PWA e desliga diagnóstico; configuração extraída é conferida', async () => {
  build({ MP_NATIVE_RELEASE: '1', MP_CSP_META: '1' });
  const c = await config();
  assert.equal(c.devBuild, false); assert.equal(c.testHooks, false); assert.equal(c.serviceWorker, false);
  assert.ok(!c.versionCode.endsWith('-dev'));
  assert.match(await readFile(new URL('../dist/index.html', import.meta.url), 'utf8'), /Content-Security-Policy/);
  const script = fileURLToPath(new URL('../../scripts/android/verificar-config.mjs', import.meta.url));
  const file = fileURLToPath(new URL('../dist/config.js', import.meta.url));
  execFileSync(process.execPath, [script, file]);
  build({}); // build de teste comum continua identificado como desenvolvimento
  assert.equal((await config()).devBuild, true);
  assert.throws(() => execFileSync(process.execPath, [script, file], { stdio: 'pipe' }));
});

test('APK de produção recusa hooks, falta de CSP ou modo de assinatura da PWA', () => {
  for (const flags of [{ MP_CSP_META: '' }, { MP_TEST_HOOKS: '1' }, { MP_MODE: 'sw' }]) {
    assert.throws(() => build({ MP_NATIVE_RELEASE: '1', MP_CSP_META: '1', ...flags }));
  }
});
