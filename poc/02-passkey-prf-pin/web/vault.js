// Cofre da chave do banco (ADR 0005).
//
// DEK: chave aleatória do banco, nunca derivada de PIN ou PRF.
// KEK: HKDF-SHA256(PRF ‖ Argon2id(PIN)) no modo passkey,
//      HKDF-SHA256(Argon2id(frase-senha)) no modo sem PRF.
// A DEK fica guardada embrulhada (AES-256-GCM) pela KEK e só existe
// desembrulhada como CryptoKey não extraível.
import init, { argon2id } from './pkg/kdf_poc.js';

export const VAULT_VERSION = 1;
export const MAX_FAILURES = 5;
// Parâmetros iniciais; ajustar depois de medir no iPhone mais fraco do grupo.
export const DEFAULT_ARGON = { m: 64 * 1024, t: 3, p: 1 };

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();

export async function loadKdf(input) {
  return init(input === undefined ? undefined : { module_or_path: input });
}

export const random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

export function b64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export class WrongSecretError extends Error {
  constructor() { super('PIN, frase-senha ou passkey não conferem'); this.name = 'WrongSecretError'; }
}
export class VaultWipedError extends Error {
  constructor() { super('Tentativas esgotadas: a chave local foi destruída'); this.name = 'VaultWipedError'; }
}

// PIN: só dígitos, 6 a 12, sem sequências e repetições óbvias.
export function checkPin(pin) {
  if (!/^\d{6,12}$/.test(pin)) return 'Use de 6 a 12 números.';
  if (/^(\d)\1+$/.test(pin)) return 'Não use o mesmo número repetido.';
  const asc = '01234567890123456789', desc = '98765432109876543210';
  if (asc.includes(pin) || desc.includes(pin)) return 'Não use sequência.';
  return null;
}

// Sem PRF o segredo é só o que a pessoa sabe: precisa ser bem mais forte.
export function checkPassphrase(p) {
  const words = p.trim().split(/\s+/).filter(Boolean);
  if (p.length < 16 && words.length < 4) return 'Use pelo menos 4 palavras ou 16 caracteres.';
  return null;
}

function aad(record) {
  return enc.encode(`mp/dek/v${record.v}/${record.mode}/${record.credentialId || '-'}`);
}

async function deriveKek(record, { prf, secret }) {
  const secretBytes = enc.encode(secret.normalize('NFKC'));
  const a = record.argon;
  const stretched = argon2id(secretBytes, unb64(record.secretSalt), a.m, a.t, a.p);
  secretBytes.fill(0);
  let ikm;
  if (record.mode === 'passkey') {
    if (!prf || prf.byteLength !== 32) throw new Error('PRF ausente ou com tamanho errado');
    ikm = new Uint8Array(64);
    ikm.set(new Uint8Array(prf), 0);
    ikm.set(stretched, 32);
  } else {
    ikm = stretched;
  }
  const base = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
  ikm.fill(0);
  stretched.fill(0);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: unb64(record.hkdfSalt), info: enc.encode(`mp/kek/v${record.v}`) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

// Cria o cofre. Devolve o registro para guardar e a DEK já não extraível.
export async function createVault({ mode, prf, secret, credentialId = null, prfSalt = null, argon = DEFAULT_ARGON }) {
  const record = {
    v: VAULT_VERSION,
    mode,
    credentialId,
    prfSalt,
    secretSalt: b64(random(16)),
    hkdfSalt: b64(random(32)),
    argon,
    iv: b64(random(12)),
    wrapped: null,
    failures: 0,
    createdAt: new Date().toISOString(),
  };
  const kek = await deriveKek(record, { prf, secret });
  const tmp = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const wrapped = await subtle.wrapKey('raw', tmp, kek, { name: 'AES-GCM', iv: unb64(record.iv), additionalData: aad(record) });
  record.wrapped = b64(new Uint8Array(wrapped));
  // Reabre pelo caminho normal: a DEK em uso nunca é extraível.
  const dek = await unwrap(record, kek);
  return { record, dek };
}

function unwrap(record, kek) {
  return subtle.unwrapKey(
    'raw', unb64(record.wrapped), kek,
    { name: 'AES-GCM', iv: unb64(record.iv), additionalData: aad(record) },
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

// Abre o cofre. `store` guarda o registro; a falha é contada ANTES de tentar,
// para que fechar o app no meio da tentativa não zere o contador.
export async function openVault(store, { prf, secret }) {
  const record = await store.load();
  if (!record || !record.wrapped) throw new VaultWipedError();
  if (record.v !== VAULT_VERSION) throw new Error(`versão de cofre desconhecida: ${record.v}`);
  record.failures += 1;
  await store.save(record);
  try {
    const kek = await deriveKek(record, { prf, secret });
    const dek = await unwrap(record, kek);
    record.failures = 0;
    await store.save(record);
    return dek;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('PRF')) throw e;
    if (record.failures >= MAX_FAILURES) {
      // Crypto-shredding: sem a DEK embrulhada, os dados locais viram ruído.
      record.wrapped = null;
      await store.save(record);
      throw new VaultWipedError();
    }
    throw new WrongSecretError();
  }
}

export async function seal(dek, text) {
  const iv = random(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, dek, enc.encode(text));
  return { iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}

export async function unseal(dek, box) {
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, dek, unb64(box.ct));
  return new TextDecoder().decode(pt);
}
