// Cofre da chave do banco (ADR 0005 e ADR 0014), usando @mp/crypto.
// DEK aleatória, embrulhada por KEK = HKDF(PRF ‖ Argon2id(PIN) ‖ S), em que
// S é a parte do servidor: só sai com o PIN certo, e quem conta os erros é o
// servidor. Uma cópia do aparelho não permite testar PINs fora dele.
import { argon2id } from '../packages/crypto/index.js';

export const VAULT_VERSION = 2;
export const MAX_FAILURES = 5;
export const DEFAULT_ARGON = { m: 64 * 1024, t: 3, p: 1 };

const subtle = crypto.subtle;
const enc = new TextEncoder();
export const random = (n) => crypto.getRandomValues(new Uint8Array(n));
export const b64 = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export class WrongSecretError extends Error { constructor() { super('PIN ou frase-senha errados'); this.name = 'WrongSecretError'; } }
export class VaultWipedError extends Error { constructor() { super('Tentativas esgotadas: chave local destruída'); this.name = 'VaultWipedError'; } }
export class OfflineError extends Error { constructor() { super('Sem conexão: o app só abre online'); this.name = 'OfflineError'; } }

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

// Parte do aparelho: PRF (Face ID/digital) ‖ Argon2id(PIN). Dela saem o
// verificador (vai ao servidor) e, junto com S, a KEK. O verificador não
// abre nada sozinho: falta S, que só o servidor tem.
async function devicePart(r, { prf, secret }) {
  const secretBytes = enc.encode(secret.normalize('NFKC'));
  const stretched = argon2id(secretBytes, unb64(r.secretSalt), r.argon.m, r.argon.t, r.argon.p);
  secretBytes.fill(0);
  if (r.mode !== 'passkey') return stretched;
  if (!prf || prf.byteLength !== 32) { stretched.fill(0); throw new Error('PRF ausente'); }
  const ikm = new Uint8Array(64); ikm.set(prf, 0); ikm.set(stretched, 32);
  stretched.fill(0);
  return ikm;
}
async function hkdf(ikm, r, info, usage) {
  const base = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey', 'deriveBits']);
  const p = { name: 'HKDF', hash: 'SHA-256', salt: unb64(r.hkdfSalt), info: enc.encode(info) };
  if (usage === 'bits') return new Uint8Array(await subtle.deriveBits(p, base, 256));
  return subtle.deriveKey(p, base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}
const verifierOf = async (part, r) => b64(await hkdf(part, r, `mp/unlock/verifier/v${r.v}`, 'bits'));
async function kekOf(part, share, r) {
  const s = unb64(share);
  const ikm = new Uint8Array(part.byteLength + s.byteLength); ikm.set(part, 0); ikm.set(s, part.byteLength);
  try { return await hkdf(ikm, r, `mp/kek/v${r.v}`, 'key'); } finally { ikm.fill(0); s.fill(0); }
}

const unwrap = (r, kek) => subtle.unwrapKey('raw', unb64(r.wrapped), kek, { name: 'AES-GCM', iv: unb64(r.iv), additionalData: aad(r) }, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

// Criação em duas etapas: a DEK já serve para abrir o banco novo; ela só é
// embrulhada (e o cofre gravado) depois que o servidor registra a parte S,
// o que exige a identidade criada e a sessão aberta.
export async function startVault({ mode, prf, secret, credentialId = null, prfSalt = null, argon = DEFAULT_ARGON }) {
  const r = { v: VAULT_VERSION, mode, credentialId, prfSalt, secretSalt: b64(random(16)), hkdfSalt: b64(random(32)), argon, iv: b64(random(12)), wrapped: null, vaultId: null };
  let part = await devicePart(r, { prf, secret });
  const verifier = await verifierOf(part, r);
  const raw = random(32);
  const dek = await subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  async function finish({ vaultId, share }) {
    const kek = await kekOf(part, share, r);
    const tmp = await subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const record = { ...r, vaultId, wrapped: b64(new Uint8Array(await subtle.wrapKey('raw', tmp, kek, { name: 'AES-GCM', iv: unb64(r.iv), additionalData: aad(r) }))) };
    raw.fill(0); part.fill(0); part = null;
    return { record, kek };
  }
  return { dek, verifier, finish, mode };
}

// Verificador de um PIN de coação (mesmos sais do cofre): o servidor guarda
// só o resumo; digitar esse PIN destrói a parte S sem nenhum aviso.
export async function duressVerifier(record, { prf, secret }) {
  const part = await devicePart(record, { prf, secret });
  try { return await verifierOf(part, record); } finally { part.fill(0); }
}

// Troca a chave do banco (rotação, "os dados morrem"): DEK nova e aleatória,
// embrulhada pela mesma KEK que já está em memória durante a sessão. A DEK
// antiga deixa de existir em qualquer registro novo.
export async function rotateDek(record, kek) {
  const r = { ...record, iv: b64(random(12)), wrapped: null };
  const tmp = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  r.wrapped = b64(new Uint8Array(await subtle.wrapKey('raw', tmp, kek, { name: 'AES-GCM', iv: unb64(r.iv), additionalData: aad(r) })));
  return { record: r, dek: await unwrap(r, kek) };
}

// Abrir: o servidor confere o verificador e conta os erros (ADR 0014).
// release(vaultId, verifier) → { share } | { gone } | { wrong, left }; erro
// de rede vira OfflineError (falha fechada: sem servidor, nada abre).
// Cofre v1 (antes da parte do servidor): abre do jeito antigo e devolve
// `upgrade`, que migra para v2 sem perder nada (ver openLegacy).
export async function openVault(store, { prf, secret, release }) {
  const r = await store.load();
  if (!r?.wrapped) throw new VaultWipedError();
  if (r.v === 1) return openLegacy(store, r, { prf, secret });
  if (!r.vaultId) throw new Error('cofre v2 sem identificador: não mexo em nada');
  const part = await devicePart(r, { prf, secret });
  try {
    const verifier = await verifierOf(part, r);
    let res;
    try { res = await release(r.vaultId, verifier); } catch { throw new OfflineError(); }
    if (res.gone) {
      // Servidor destruiu a parte S (erros, coação, emergência ou prazo):
      // o embrulho local não serve para mais nada; apaga também.
      await store.save({ ...r, wrapped: null });
      throw new VaultWipedError();
    }
    if (res.wrong) { const e = new WrongSecretError(); e.left = res.left; throw e; }
    const kek = await kekOf(part, res.share, r);
    const dek = await unwrap(r, kek);
    if (!res.needsMigration) return { dek, kek };
    let retained = part.slice();
    const forget = () => { retained?.fill(0); retained = null; };
    // A substituição prepara S nova, mas mantém o cofre antigo até o cliente
    // gravar banco/DEK/embrulho novos numa única troca durável.
    async function migrate(prepare) {
      if (!retained) throw new Error('sessão da migração encerrada');
      try {
        const reg = await prepare(r.vaultId);
        const nextKek = await kekOf(retained, reg.share, r);
        const rotated = await rotateDek({ ...r, vaultId: reg.vaultId }, nextKek);
        return { ...rotated, kek: nextKek, previous: r.vaultId };
      } finally { forget(); }
    }
    return { dek, kek, migrate, forget };
  } finally { part.fill(0); }
}

// Cofre v1: KEK = HKDF(PRF ‖ Argon2id(PIN)), erros contados no aparelho (como
// era). Depois de aberto, `upgrade(register)` cria o registro v2 (mesmo PIN e
// mesma passkey, sais novos), registra o verificador no servidor, embrulha a
// MESMA DEK com a KEK nova e devolve { record, kek }. O banco não muda.
async function openLegacy(store, r, { prf, secret }) {
  r.failures = (r.failures ?? 0) + 1;
  await store.save(r); // conta ANTES de tentar (fechar o app não zera)
  let part = await devicePart(r, { prf, secret });
  let kek, dekX;
  try {
    kek = await hkdf(part, r, `mp/kek/v${r.v}`, 'key');
    dekX = await subtle.unwrapKey('raw', unb64(r.wrapped), kek, { name: 'AES-GCM', iv: unb64(r.iv), additionalData: aad(r) }, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  } catch (e) {
    part.fill(0);
    if (r.failures >= MAX_FAILURES) { await store.save({ ...r, wrapped: null }); throw new VaultWipedError(); }
    throw new WrongSecretError();
  }
  r.failures = 0;
  await store.save(r);
  const dek = await unwrap(r, kek);
  async function upgrade(register) {
    const n = { v: VAULT_VERSION, mode: r.mode, credentialId: r.credentialId, prfSalt: r.prfSalt, secretSalt: r.secretSalt, argon: r.argon,
      hkdfSalt: b64(random(32)), iv: b64(random(12)), wrapped: null, vaultId: null };
    const reg = await register({ verifier: await verifierOf(part, n) });
    const kek2 = await kekOf(part, reg.share, n);
    n.vaultId = reg.vaultId;
    n.wrapped = b64(new Uint8Array(await subtle.wrapKey('raw', dekX, kek2, { name: 'AES-GCM', iv: unb64(n.iv), additionalData: aad(n) })));
    // Confere antes de trocar: o novo embrulho abre a mesma chave.
    await unwrap(n, kek2);
    forget();
    return { record: n, kek: kek2 };
  }
  function forget() { part?.fill(0); part = null; dekX = null; }
  return { dek, kek, upgrade, forget };
}
