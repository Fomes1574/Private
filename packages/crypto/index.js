// Ponto de entrada da criptografia do app: WASM (vodozemac + Argon2id) e
// o formato de envelope externo versionado (ADR 0003).
import init, { OlmAccount, OlmSession, argon2id, vodozemacVersion } from './pkg/mp_crypto.js';

export { OlmAccount, OlmSession, argon2id, vodozemacVersion };

export const OUTER_VERSION = 1;
export const OUTER_ALG = 'olm.v1.curve25519-aes-sha2';

export async function loadCrypto(input) {
  return init(input === undefined ? undefined : { module_or_path: input });
}

const b64 = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
export { b64, unb64 };

// Envelope externo: cabeçalho de versão + mensagem Olm. Serializado como
// JSON e depois base64 para viajar ao servidor.
export function sealOuter(session, innerBytes) {
  const m = session.encrypt(innerBytes);
  const env = { v: OUTER_VERSION, alg: OUTER_ALG, t: m.messageType, body: b64(m.body) };
  m.free();
  return btoa(JSON.stringify(env));
}

export function parseOuter(ct) {
  let env;
  try { env = JSON.parse(atob(ct)); } catch { throw new Error('envelope ilegível'); }
  if (env.v !== OUTER_VERSION || env.alg !== OUTER_ALG) throw new Error(`envelope recusado: v=${env.v} alg=${env.alg}`);
  if (env.t !== 0 && env.t !== 1) throw new Error('tipo de mensagem Olm inválido');
  return { type: env.t, body: unb64(env.body) };
}
