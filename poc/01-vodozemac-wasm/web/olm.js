// Camada fina sobre o WASM: envelope versionado (V7-003) e utilidades.
// Usada igual pela página e pelo teste em Node.
import init, { OlmAccount, OlmSession, vodozemacVersion } from './pkg/vz_poc.js';

export { OlmAccount, OlmSession, vodozemacVersion };

export const ENVELOPE_VERSION = 1;
export const ENVELOPE_ALG = 'olm.v1.curve25519-aes-sha2';

const enc = new TextEncoder();
const dec = new TextDecoder();

export async function loadWasm(input) {
  return init(input === undefined ? undefined : { module_or_path: input });
}

export function b64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function unb64(str) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

// Todo envelope carrega versão e algoritmo desde o primeiro envio.
export function seal(session, text) {
  const m = session.encrypt(enc.encode(text));
  const env = { v: ENVELOPE_VERSION, alg: ENVELOPE_ALG, t: m.messageType, body: b64(m.body) };
  m.free();
  return env;
}

export function checkEnvelope(env) {
  if (env.v !== ENVELOPE_VERSION || env.alg !== ENVELOPE_ALG) {
    throw new Error(`envelope recusado: v=${env.v} alg=${env.alg}`);
  }
}

export function open(session, env) {
  checkEnvelope(env);
  return dec.decode(session.decrypt(env.t, unb64(env.body)));
}

// Bob recebe a primeira mensagem (pre-key) de Alice e cria a sessão de entrada.
export function openFirst(account, senderIdentityKey, env) {
  checkEnvelope(env);
  if (env.t !== 0) throw new Error('primeira mensagem precisa ser pre-key');
  const r = account.createInboundSession(senderIdentityKey, env.t, unb64(env.body));
  const text = dec.decode(r.takePlaintext());
  const session = r.takeSession();
  r.free();
  return { session, text };
}

// Alice pega uma chave de uso único publicada por Bob e abre a sessão de saída.
export function startSession(alice, bob) {
  bob.generateOneTimeKeys(1);
  const [otk] = Object.values(JSON.parse(bob.oneTimeKeys()));
  bob.markKeysAsPublished();
  return alice.createOutboundSession(bob.curve25519Key, otk);
}
