// Testes automáticos rodados no próprio aparelho (mesma lógica de test/olm.test.mjs).
import * as olm from './olm.js';

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function throws(fn, msg) {
  try { fn(); } catch { return; }
  throw new Error(msg);
}
const key = () => crypto.getRandomValues(new Uint8Array(32));

function pair() {
  const alice = new olm.OlmAccount();
  const bob = new olm.OlmAccount();
  const aSess = olm.startSession(alice, bob);
  const { session: bSess, text } = olm.openFirst(bob, alice.curve25519Key, olm.seal(aSess, 'oi'));
  assert(text === 'oi', 'primeira mensagem');
  olm.open(aSess, olm.seal(bSess, 'ack'));
  return { alice, bob, aSess, bSess };
}

const cases = {
  'troca nos dois sentidos (100 mensagens)': () => {
    const { aSess, bSess } = pair();
    for (let i = 0; i < 50; i++) {
      assert(olm.open(bSess, olm.seal(aSess, `a${i}`)) === `a${i}`, 'a->b');
      assert(olm.open(aSess, olm.seal(bSess, `b${i}`)) === `b${i}`, 'b->a');
    }
  },
  'salvar e restaurar estado cifrado': () => {
    const { alice, aSess, bSess } = pair();
    const k = key();
    const pa = alice.pickle(k), ps = aSess.pickle(k);
    const id = alice.curve25519Key;
    const a2 = olm.OlmAccount.fromPickle(pa, k);
    const s2 = olm.OlmSession.fromPickle(ps, k);
    assert(a2.curve25519Key === id, 'identidade preservada');
    assert(olm.open(bSess, olm.seal(s2, 'pós')) === 'pós', 'sessão restaurada');
  },
  'chave errada não abre o estado': () => {
    const { aSess } = pair();
    const p = aSess.pickle(key());
    throws(() => olm.OlmSession.fromPickle(p, key()), 'abriu com chave errada');
  },
  'fora de ordem': () => {
    const { aSess, bSess } = pair();
    const m = [0, 1, 2, 3, 4].map((i) => olm.seal(aSess, `m${i}`));
    for (const i of [3, 0, 4, 2, 1]) assert(olm.open(bSess, m[i]) === `m${i}`, `m${i}`);
  },
  'replay recusado': () => {
    const { aSess, bSess } = pair();
    const m = olm.seal(aSess, 'x');
    olm.open(bSess, m);
    throws(() => olm.open(bSess, m), 'replay aceito');
  },
  'adulteração recusada': () => {
    const { aSess, bSess } = pair();
    const m = olm.seal(aSess, 'íntegro');
    const b = olm.unb64(m.body);
    b[b.length - 12] ^= 1;
    throws(() => olm.open(bSess, { ...m, body: olm.b64(b) }), 'adulterado aceito');
  },
  'versão desconhecida recusada': () => {
    const { aSess, bSess } = pair();
    throws(() => olm.open(bSess, { ...olm.seal(aSess, 'x'), v: 0 }), 'downgrade aceito');
  },
};

export async function runSelfTest() {
  const results = [];
  for (const [name, fn] of Object.entries(cases)) {
    const t0 = performance.now();
    try {
      fn();
      results.push({ name, ok: true, ms: +(performance.now() - t0).toFixed(1) });
    } catch (e) {
      results.push({ name, ok: false, error: String(e.message || e) });
    }
    await new Promise((r) => setTimeout(r)); // deixa a tela respirar
  }
  return results;
}

// Mede quanto custa cifrar uma mensagem para N destinatários (fan-out, V7-002).
export function benchFanout(recipients = 9, rounds = 20) {
  const sessions = [];
  for (let i = 0; i < recipients; i++) sessions.push(pair().aSess);
  const text = 'x'.repeat(200);
  const t0 = performance.now();
  for (let r = 0; r < rounds; r++) for (const s of sessions) olm.seal(s, text);
  const per = (performance.now() - t0) / rounds;
  return { recipients, msPerFanout: +per.toFixed(2) };
}
