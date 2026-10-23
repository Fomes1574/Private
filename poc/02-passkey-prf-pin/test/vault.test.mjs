import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as v from '../web/vault.js';

await v.loadKdf(await readFile(new URL('../web/pkg/kdf_poc_bg.wasm', import.meta.url)));
const FAST = { m: 1024, t: 1, p: 1 }; // testes rápidos; o app usa DEFAULT_ARGON

function memStore() {
  let rec = null;
  return { load: async () => (rec ? structuredClone(rec) : null), save: async (r) => { rec = structuredClone(r); }, peek: () => rec };
}


test('vetor Argon2id: password/somesalt m=64MiB t=2 p=1', async () => {
  const { argon2id } = await import('../web/pkg/kdf_poc.js');
  const h = argon2id(new TextEncoder().encode('password'), new TextEncoder().encode('somesalt'), 65536, 2, 1);
  assert.equal(Buffer.from(h).toString('hex'), '09316115d5cf24ed5a15a31a3ba326e5cf32edc24702987c02b6566f61913cf7');
});

test('modo passkey: precisa do PRF e do PIN certos', async () => {
  const prf = v.random(32);
  const store = memStore();
  const { record, dek } = await v.createVault({ mode: 'passkey', prf, secret: '284917', credentialId: 'cred', argon: FAST });
  await store.save(record);
  const box = await v.seal(dek, 'segredo');
  const dek2 = await v.openVault(store, { prf, secret: '284917' });
  assert.equal(await v.unseal(dek2, box), 'segredo');
  await assert.rejects(v.openVault(store, { prf, secret: '284918' }), v.WrongSecretError);
  await assert.rejects(v.openVault(store, { prf: v.random(32), secret: '284917' }), v.WrongSecretError);
  assert.equal(store.peek().failures, 2);
  await v.openVault(store, { prf, secret: '284917' });
  assert.equal(store.peek().failures, 0, 'sucesso zera o contador');
});

test('DEK não é extraível', async () => {
  const { dek } = await v.createVault({ mode: 'passkey', prf: v.random(32), secret: '284917', argon: FAST });
  assert.equal(dek.extractable, false);
  await assert.rejects(crypto.subtle.exportKey('raw', dek));
});

test('cinco erros destroem a chave local', async () => {
  const prf = v.random(32);
  const store = memStore();
  const { record } = await v.createVault({ mode: 'passkey', prf, secret: '284917', argon: FAST });
  await store.save(record);
  for (let i = 1; i < v.MAX_FAILURES; i++) await assert.rejects(v.openVault(store, { prf, secret: '000001' }), v.WrongSecretError);
  await assert.rejects(v.openVault(store, { prf, secret: '000001' }), v.VaultWipedError);
  assert.equal(store.peek().wrapped, null);
  await assert.rejects(v.openVault(store, { prf, secret: '284917' }), v.VaultWipedError, 'nem o PIN certo abre depois');
});

test('falha contada antes da tentativa (fechar no meio não zera)', async () => {
  const prf = v.random(32);
  const store = memStore();
  const { record } = await v.createVault({ mode: 'passkey', prf, secret: '284917', argon: FAST });
  await store.save(record);
  // Simula app morto durante a derivação: o save do contador já aconteceu.
  const crashing = { load: store.load, save: async (r) => { await store.save(r); throw new Error('app fechado'); } };
  await assert.rejects(v.openVault(crashing, { prf, secret: '000001' }), /app fechado/);
  assert.equal(store.peek().failures, 1);
});

test('modo frase-senha sem PRF', async () => {
  const store = memStore();
  const { record } = await v.createVault({ mode: 'passphrase', secret: 'cavalo bateria grampo correto', argon: FAST });
  await store.save(record);
  await v.openVault(store, { secret: 'cavalo bateria grampo correto' });
  await assert.rejects(v.openVault(store, { secret: 'cavalo bateria grampo errado' }), v.WrongSecretError);
});

test('registro adulterado (troca de modo ou credencial) não abre', async () => {
  const prf = v.random(32);
  const store = memStore();
  const { record } = await v.createVault({ mode: 'passkey', prf, secret: '284917', credentialId: 'A', argon: FAST });
  await store.save({ ...record, credentialId: 'B' });
  await assert.rejects(v.openVault(store, { prf, secret: '284917' }), v.WrongSecretError);
});

test('regras de PIN e frase-senha', () => {
  assert.ok(v.checkPin('12345'));
  assert.ok(v.checkPin('123456'));
  assert.ok(v.checkPin('111111'));
  assert.ok(v.checkPin('654321'));
  assert.ok(v.checkPin('12a456'));
  assert.equal(v.checkPin('284917'), null);
  assert.ok(v.checkPassphrase('curta'));
  assert.equal(v.checkPassphrase('quatro palavras bem diferentes'), null);
});
