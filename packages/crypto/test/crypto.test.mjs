import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as c from '../index.js';

await c.loadCrypto(await readFile(new URL('../pkg/mp_crypto_bg.wasm', import.meta.url)));
const enc = new TextEncoder(), dec = new TextDecoder();

function session(alice, bob, { fallback = false } = {}) {
  let key;
  if (fallback) { bob.generateFallbackKey(); [key] = Object.values(JSON.parse(bob.fallbackKey())); }
  else { bob.generateOneTimeKeys(1); [key] = Object.values(JSON.parse(bob.oneTimeKeys())); }
  bob.markKeysAsPublished();
  return alice.createOutboundSession(bob.curve25519Key, key);
}

test('troca com envelope externo versionado', () => {
  const a = new c.OlmAccount(), b = new c.OlmAccount();
  const s = session(a, b);
  const ct = c.sealOuter(s, enc.encode('oi'));
  const { type, body } = c.parseOuter(ct);
  assert.equal(type, 0);
  const r = b.createInboundSession(a.curve25519Key, type, body);
  assert.equal(dec.decode(r.takePlaintext()), 'oi');
  const bs = r.takeSession();
  const back = c.parseOuter(c.sealOuter(bs, enc.encode('olá')));
  assert.equal(dec.decode(s.decrypt(back.type, back.body)), 'olá');
});

test('sessão pela chave de reserva quando acabam as de uso único', () => {
  const a = new c.OlmAccount(), b = new c.OlmAccount();
  const s = session(a, b, { fallback: true });
  const { type, body } = c.parseOuter(c.sealOuter(s, enc.encode('via reserva')));
  assert.equal(dec.decode(b.createInboundSession(a.curve25519Key, type, body).takePlaintext()), 'via reserva');
});

test('envelope externo com versão ou algoritmo desconhecido é recusado', () => {
  const bad = (o) => btoa(JSON.stringify(o));
  assert.throws(() => c.parseOuter(bad({ v: 2, alg: c.OUTER_ALG, t: 0, body: '' })), /recusado/);
  assert.throws(() => c.parseOuter(bad({ v: 1, alg: 'megolm', t: 0, body: '' })), /recusado/);
  assert.throws(() => c.parseOuter(bad({ v: 1, alg: c.OUTER_ALG, t: 7, body: '' })), /tipo/);
  assert.throws(() => c.parseOuter('não é base64!'), /ilegível/);
});

test('Argon2id bate com o vetor de referência', () => {
  const h = c.argon2id(enc.encode('password'), enc.encode('somesalt'), 65536, 2, 1);
  assert.equal(Buffer.from(h).toString('hex'), '09316115d5cf24ed5a15a31a3ba326e5cf32edc24702987c02b6566f61913cf7');
});

test('estado salvo e restaurado com chave; chave errada não abre', () => {
  const a = new c.OlmAccount();
  const k = crypto.getRandomValues(new Uint8Array(32));
  const p = a.pickle(k);
  assert.equal(c.OlmAccount.fromPickle(p, k).curve25519Key, a.curve25519Key);
  assert.throws(() => c.OlmAccount.fromPickle(p, crypto.getRandomValues(new Uint8Array(32))));
});
