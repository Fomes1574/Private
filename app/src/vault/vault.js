// Cofre da chave do banco (ADR 0005), revisado da Prova 2 e usando @mp/crypto.
// DEK aleatória, embrulhada por KEK = HKDF(PRF ‖ Argon2id(PIN)).
import { argon2id } from '../packages/crypto/index.js';

export const VAULT_VERSION = 1;
export const MAX_FAILURES = 5;
export const DEFAULT_ARGON = { m: 64 * 1024, t: 3, p: 1 };

const subtle = crypto.subtle;
const enc = new TextEncoder();
export const random = (n) => crypto.getRandomValues(new Uint8Array(n));
export const b64 = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export class WrongSecretError extends Error { constructor() { super('PIN ou frase-senha errados'); this.name = 'WrongSecretError'; } }
export class VaultWipedError extends Error { constructor() { super('Tentativas esgotadas: chave local destruída'); this.name = 'VaultWipedError'; } }

export function checkPin(pin) {
  if (!/^\d{6,12}$/.test(pin)) return 'Use de 6 a 12 números.';
  if (/^(\d)\1+$/.test(pin)) return 'Não use o mesmo número repetido.';
  const asc = '01234567890123456789', desc = '98765432109876543210';
  if (asc.includes(pin) || desc.includes(pin)) return 'Não use sequência.';
  return null;
}
export function checkPassphrase(p) {
  const words = p.trim().split(/\s+/).filter(Boolean);
  if (p.length < 16 && words.length < 4) return 'Use pelo menos 4 palavras ou 16 caracteres.';
  return null;
}

const aad = (r) => enc.encode(`mp/dek/v${r.v}/${r.mode}/${r.credentialId || '-'}`);

async function deriveKek(r, { prf, secret }) {
  const secretBytes = enc.encode(secret.normalize('NFKC'));
  const stretched = argon2id(secretBytes, unb64(r.secretSalt), r.argon.m, r.argon.t, r.argon.p);
  secretBytes.fill(0);
  let ikm;
  if (r.mode === 'passkey') {
    if (!prf || prf.byteLength !== 32) throw new Error('PRF ausente');
    ikm = new Uint8Array(64); ikm.set(prf, 0); ikm.set(stretched, 32);
  } else ikm = stretched;
  const base = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
  ikm.fill(0); stretched.fill(0);
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: unb64(r.hkdfSalt), info: enc.encode(`mp/kek/v${r.v}`) }, base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}

const unwrap = (r, kek) => subtle.unwrapKey('raw', unb64(r.wrapped), kek, { name: 'AES-GCM', iv: unb64(r.iv), additionalData: aad(r) }, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

export async function createVault({ mode, prf, secret, credentialId = null, prfSalt = null, argon = DEFAULT_ARGON }) {
  const r = { v: VAULT_VERSION, mode, credentialId, prfSalt, secretSalt: b64(random(16)), hkdfSalt: b64(random(32)), argon, iv: b64(random(12)), wrapped: null, failures: 0 };
  const kek = await deriveKek(r, { prf, secret });
  const tmp = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  r.wrapped = b64(new Uint8Array(await subtle.wrapKey('raw', tmp, kek, { name: 'AES-GCM', iv: unb64(r.iv), additionalData: aad(r) })));
  return { record: r, dek: await unwrap(r, kek), kek };
}

// Troca a chave do banco (rotação, "os dados morrem"): DEK nova e aleatória,
// embrulhada pela mesma KEK que já está em memória durante a sessão. A DEK
// antiga deixa de existir em qualquer registro novo.
export async function rotateDek(record, kek) {
  const r = { ...record, iv: b64(random(12)), wrapped: null, failures: 0 };
  const tmp = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  r.wrapped = b64(new Uint8Array(await subtle.wrapKey('raw', tmp, kek, { name: 'AES-GCM', iv: unb64(r.iv), additionalData: aad(r) })));
  return { record: r, dek: await unwrap(r, kek) };
}

// O erro é contado ANTES de tentar: fechar o app no meio não zera o contador.
export async function openVault(store, { prf, secret }) {
  const r = await store.load();
  if (!r?.wrapped) throw new VaultWipedError();
  r.failures += 1;
  await store.save(r);
  try {
    const kek = await deriveKek(r, { prf, secret });
    const dek = await unwrap(r, kek);
    r.failures = 0;
    await store.save(r);
    return { dek, kek };
  } catch (e) {
    if (e instanceof Error && e.message === 'PRF ausente') throw e;
    if (r.failures >= MAX_FAILURES) { r.wrapped = null; await store.save(r); throw new VaultWipedError(); }
    throw new WrongSecretError();
  }
}
