// Teste em Node do mesmo WASM e da mesma camada usada na página.
// Rodar: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import * as olm from '../web/olm.js';

await olm.loadWasm(await readFile(new URL('../web/pkg/vz_poc_bg.wasm', import.meta.url)));
const key = () => webcrypto.getRandomValues(new Uint8Array(32));

function pair() {
  const alice = new olm.OlmAccount();
  const bob = new olm.OlmAccount();
  const aSess = olm.startSession(alice, bob);
  const first = olm.seal(aSess, 'oi bob');
  const { session: bSess, text } = olm.openFirst(bob, alice.curve25519Key, first);
  assert.equal(text, 'oi bob');
  return { alice, bob, aSess, bSess };
}

test('troca nos dois sentidos', () => {
  const { aSess, bSess } = pair();
  assert.equal(olm.open(aSess, olm.seal(bSess, 'oi alice')), 'oi alice');
  for (let i = 0; i < 20; i++) {
    assert.equal(olm.open(bSess, olm.seal(aSess, `a${i}`)), `a${i}`);
    assert.equal(olm.open(aSess, olm.seal(bSess, `b${i}`)), `b${i}`);
  }
});

test('sobrevive a salvar e restaurar (pickle cifrado)', () => {
  const { alice, bob, aSess, bSess } = pair();
  const ka = key(), kb = key();
  const saved = {
    a: alice.pickle(ka), as: aSess.pickle(ka),
    b: bob.pickle(kb), bs: bSess.pickle(kb),
  };
  const aIdentity = alice.curve25519Key;
  for (const o of [alice, bob, aSess, bSess]) o.free();

  const alice2 = olm.OlmAccount.fromPickle(saved.a, ka);
  const aSess2 = olm.OlmSession.fromPickle(saved.as, ka);
  const bSess2 = olm.OlmSession.fromPickle(saved.bs, kb);
  assert.equal(alice2.curve25519Key, aIdentity);
  assert.equal(olm.open(bSess2, olm.seal(aSess2, 'depois de reabrir')), 'depois de reabrir');
  assert.equal(olm.open(aSess2, olm.seal(bSess2, 'resposta')), 'resposta');
});

test('chave de pickle errada não abre o estado', () => {
  const { aSess } = pair();
  const p = aSess.pickle(key());
  assert.throws(() => olm.OlmSession.fromPickle(p, key()));
  assert.throws(() => olm.OlmSession.fromPickle(p, new Uint8Array(16)));
});

test('mensagens fora de ordem', () => {
  const { aSess, bSess } = pair();
  olm.open(aSess, olm.seal(bSess, 'ack')); // Alice sai do modo pre-key
  const msgs = [0, 1, 2, 3, 4].map((i) => olm.seal(aSess, `m${i}`));
  for (const i of [3, 0, 4, 2, 1]) assert.equal(olm.open(bSess, msgs[i]), `m${i}`);
});

test('replay da mesma mensagem é recusado', () => {
  const { aSess, bSess } = pair();
  olm.open(aSess, olm.seal(bSess, 'ack'));
  const m = olm.seal(aSess, 'uma vez');
  assert.equal(olm.open(bSess, m), 'uma vez');
  assert.throws(() => olm.open(bSess, m));
});

test('texto adulterado é recusado', () => {
  const { aSess, bSess } = pair();
  olm.open(aSess, olm.seal(bSess, 'ack'));
  const m = olm.seal(aSess, 'íntegro');
  const body = olm.unb64(m.body);
  body[body.length - 12] ^= 1;
  assert.throws(() => olm.open(bSess, { ...m, body: olm.b64(body) }));
});

test('envelope com versão desconhecida é recusado (sem downgrade)', () => {
  const { aSess, bSess } = pair();
  const m = olm.seal(aSess, 'x');
  assert.throws(() => olm.open(bSess, { ...m, v: 0 }), /envelope recusado/);
  assert.throws(() => olm.open(bSess, { ...m, alg: 'megolm' }), /envelope recusado/);
});

test('chave de uso único não serve duas vezes', () => {
  const alice = new olm.OlmAccount();
  const bob = new olm.OlmAccount();
  bob.generateOneTimeKeys(1);
  const [otk] = Object.values(JSON.parse(bob.oneTimeKeys()));
  const s1 = alice.createOutboundSession(bob.curve25519Key, otk);
  const s2 = alice.createOutboundSession(bob.curve25519Key, otk);
  olm.openFirst(bob, alice.curve25519Key, olm.seal(s1, 'primeira'));
  assert.throws(() => olm.openFirst(bob, alice.curve25519Key, olm.seal(s2, 'segunda')));
});
