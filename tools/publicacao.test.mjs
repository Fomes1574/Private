import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertValidated, main } from '../scripts/verificar-ci.mjs';
const sha = 'a'.repeat(40);
const run = (path, changes = {}) => ({ id: 1, path: `.github/workflows/${path}.yml`, event: 'push', head_branch: 'ccr-de59a90b-gr4vug', head_sha: sha, status: 'completed', conclusion: 'success', ...changes });

test('publicação exige sucesso do mesmo commit; APK também exige o teste Android', () => {
  assert.doesNotThrow(() => assertValidated([run('ci')], sha));
  assert.doesNotThrow(() => assertValidated([run('ci', { event: 'workflow_dispatch' }), run('android', { event: 'workflow_dispatch' })], sha, { android: true }));
  assert.throws(() => assertValidated([run('ci')], sha, { android: true }));
  assert.doesNotThrow(() => assertValidated([run('ci'), run('android')], sha, { android: true }));
  for (const changes of [{ conclusion: 'failure' }, { status: 'in_progress' }, { head_sha: 'b'.repeat(40) }, { head_branch: 'outra' }, { event: 'pull_request' }]) assert.throws(() => assertValidated([run('ci', changes)], sha));
  assert.throws(() => assertValidated([run('ci'), run('ci', { id: 2, conclusion: 'failure' })], sha));
});

test('publicação de outra branch falha antes de consultar rede ou carregar chave', async () => {
  await assert.rejects(main({ GITHUB_REF: 'refs/heads/outra' }), /somente na branch/);
});
