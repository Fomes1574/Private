// Durable Object único do círculo: identidades, convites, aparelho único por
// pessoa, sessões, chaves de uso único (Olm), troca de aparelho por QR e
// recuperação. Um só objeto = decisões atômicas (limite de 10, convite usado
// uma vez, troca de aparelho) sem corrida.
import { DurableObject } from 'cloudflare:workers';
import { randomId, sha256b64, unb64 } from './http.js';

export const MAX_IDENTITIES = 10; // V6-001
const DAY = 86_400_000;
const INVITE_TTL = DAY; // convite de uso único, expiração curta (§5)
const SESSION_TTL = 12 * 3600_000;
const CHALLENGE_TTL = 2 * 60_000;
const PAIRING_TTL = 5 * 60_000;
export const RECOVERY_WAIT = DAY; // V7-012: 24 h obrigatórias
const MAX_OTKS = 100;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS identities (user_id TEXT PRIMARY KEY, state TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0,
  guardian TEXT, joined_seq INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS devices (device_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, auth_pub TEXT NOT NULL,
  curve TEXT NOT NULL, ed TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER);
CREATE INDEX IF NOT EXISTS devices_user ON devices(user_id, state);
CREATE TABLE IF NOT EXISTS invites (token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, for_user TEXT, created_by TEXT NOT NULL,
  expires_at INTEGER NOT NULL, used_at INTEGER);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, device_id TEXT NOT NULL, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS challenges (nonce TEXT PRIMARY KEY, device_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS otks (device_id TEXT NOT NULL, key_id TEXT NOT NULL, key TEXT NOT NULL, PRIMARY KEY (device_id, key_id));
CREATE TABLE IF NOT EXISTS fallback_keys (device_id TEXT PRIMARY KEY, key_id TEXT NOT NULL, key TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pairings (pairing_id TEXT PRIMARY KEY, code_hash TEXT NOT NULL, auth_pub TEXT NOT NULL, curve TEXT NOT NULL,
  ed TEXT NOT NULL, keys_json TEXT NOT NULL DEFAULT '{}', expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS recoveries (user_id TEXT PRIMARY KEY, state TEXT NOT NULL, by_admin TEXT, by_guardian TEXT,
  wait_until INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS push_subs (device_id TEXT PRIMARY KEY, endpoint TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS security_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL, user_id TEXT);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS vaults (vault_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, device_id TEXT NOT NULL,
  verifier_hash TEXT NOT NULL, duress_hash TEXT, share TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  last_seen INTEGER NOT NULL, dead_days INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS kill_codes (user_id TEXT PRIMARY KEY, code_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS visuals (owner TEXT NOT NULL, slot TEXT NOT NULL, media_id TEXT NOT NULL, PRIMARY KEY (owner, slot));`;

const B64_32 = /^[A-Za-z0-9+/]{43}=$/;
const DEAD_DAYS = [0, 1, 3, 7, 15, 30]; // 0 = desligado
const VAULT_MAX_FAILURES = 5;
const b64 = (bytes) => { let s = ''; for (const x of bytes) s += String.fromCharCode(x); return btoa(s); };
async function sha(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...d].map((x) => x.toString(16).padStart(2, '0')).join('');
}
// Comparação em tempo constante (hex de mesmo tamanho).
function sameHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const KEY_RE = /^[A-Za-z0-9+/]{43}=?$/; // chave Curve25519/Ed25519 em base64 (32 bytes)
const P256_RE = /^[A-Za-z0-9+/]{87}=?$/; // ponto P-256 não comprimido (65 bytes)

function checkDevice(d) {
  if (!d || !P256_RE.test(d.authPub ?? '') || !KEY_RE.test(d.curve ?? '') || !KEY_RE.test(d.ed ?? '')) return false;
  return true;
}

export class Circle extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(SCHEMA);
  }

  q(query, ...args) { return this.sql.exec(query, ...args).toArray(); }
  one(query, ...args) { return this.q(query, ...args)[0] ?? null; }
  now() { return Date.now(); }
  event(kind, userId = null) {
    this.sql.exec('INSERT INTO security_events(at, kind, user_id) VALUES (?, ?, ?)', this.now(), kind, userId);
    this.prune();
  }

  // Metadados com prazo (P-15, ADR 0012): avisos de segurança por 30 dias,
  // convites usados ou vencidos por 1 dia, recuperações encerradas por 30 dias.
  prune() {
    const now = this.now();
    this.sql.exec('DELETE FROM security_events WHERE at < ?', now - 30 * DAY);
    this.sql.exec('DELETE FROM invites WHERE expires_at < ? OR (used_at IS NOT NULL AND used_at < ?)', now - DAY, now - DAY);
    this.sql.exec("DELETE FROM recoveries WHERE state IN ('done', 'cancelled') AND created_at < ?", now - 30 * DAY);
    this.sql.exec('DELETE FROM sessions WHERE expires_at <= ?', now);
    this.sql.exec('DELETE FROM challenges WHERE expires_at <= ?', now);
    this.sql.exec('DELETE FROM pairings WHERE expires_at <= ?', now);
    // Interruptor do homem morto: aparelho sumido há mais que o combinado
    // perde a parte do servidor; o banco dele vira ruído para sempre.
    this.sql.exec('DELETE FROM vaults WHERE dead_days > 0 AND last_seen + dead_days * ? < ?', this.vaultDay(), now);
  }

  activeCount() { return this.one("SELECT count(*) AS n FROM identities WHERE state != 'removed'").n; }
  identity(userId) { return this.one('SELECT * FROM identities WHERE user_id = ?', userId); }
  activeDevice(userId) { return this.one("SELECT * FROM devices WHERE user_id = ? AND state = 'active'", userId); }

  createIdentity(device, { isAdmin = false, userId = randomId(12) } = {}) {
    const seq = (this.one('SELECT max(joined_seq) AS m FROM identities').m ?? -1) + 1;
    this.sql.exec('INSERT INTO identities(user_id, state, is_admin, joined_seq, created_at) VALUES (?, ?, ?, ?, ?)', userId, 'active', isAdmin ? 1 : 0, seq, this.now());
    const deviceId = this.addDevice(userId, device);
    return { userId, deviceId };
  }

  addDevice(userId, device) {
    const deviceId = randomId(12);
    this.sql.exec("INSERT INTO devices(device_id, user_id, auth_pub, curve, ed, state, created_at) VALUES (?, ?, ?, ?, ?, 'active', ?)",
      deviceId, userId, device.authPub, device.curve, device.ed, this.now());
    if (device.otks) this.storeOtks(deviceId, device.otks);
    if (device.fallback) this.storeFallback(deviceId, device.fallback);
    return deviceId;
  }

  // Revoga aparelho e todas as sessões dele (V6-002: um aparelho por pessoa).
  revokeDevicesOf(userId, exceptDeviceId = null) {
    const devs = this.q("SELECT device_id FROM devices WHERE user_id = ? AND state = 'active'", userId).filter((d) => d.device_id !== exceptDeviceId);
    for (const d of devs) {
      this.sql.exec("UPDATE devices SET state = 'revoked', revoked_at = ? WHERE device_id = ?", this.now(), d.device_id);
      this.sql.exec('DELETE FROM sessions WHERE device_id = ?', d.device_id);
      this.sql.exec('DELETE FROM otks WHERE device_id = ?', d.device_id);
      this.sql.exec('DELETE FROM fallback_keys WHERE device_id = ?', d.device_id);
      this.sql.exec('DELETE FROM push_subs WHERE device_id = ?', d.device_id);
    }
    return devs.length;
  }

  // ---------- primeira pessoa (administradora) ----------
  bootstrap({ device }) {
    if (this.activeCount() > 0) return { error: 'exists' };
    if (!checkDevice(device)) return { error: 'bad_device' };
    const r = this.createIdentity(device, { isAdmin: true });
    this.event('bootstrap', r.userId);
    return r;
  }

  // ---------- convites ----------
  async createInvite(actorUserId, { kind = 'join', forUser = null } = {}) {
    const actor = this.identity(actorUserId);
    if (!actor?.is_admin || actor.state !== 'active') return { error: 'forbidden' };
    if (kind === 'join' && this.activeCount() >= MAX_IDENTITIES) return { error: 'circle_full' };
    if (kind === 'recovery') {
      const rec = this.one('SELECT * FROM recoveries WHERE user_id = ?', forUser);
      if (!rec || rec.state !== 'waiting') return { error: 'bad_state' };
      if (this.now() < rec.wait_until) return { error: 'too_early' }; // nunca antes das 24 h (V7-012)
    }
    const token = randomId(32); // 256 bits
    this.sql.exec('INSERT INTO invites(token_hash, kind, for_user, created_by, expires_at) VALUES (?, ?, ?, ?, ?)',
      await sha256b64(token), kind, forUser, actorUserId, this.now() + INVITE_TTL);
    this.event(`invite_${kind}`, forUser);
    return { token, expiresAt: this.now() + INVITE_TTL };
  }

  // Consumo atômico: convite usado, vencido ou círculo cheio = recusa (§5).
  async redeem({ token, device }) {
    if (typeof token !== 'string' || token.length < 40) return { error: 'unauthorized' };
    if (!checkDevice(device)) return { error: 'bad_device' };
    const inv = this.one('SELECT * FROM invites WHERE token_hash = ?', await sha256b64(token));
    if (!inv || inv.used_at || inv.expires_at <= this.now()) return { error: 'unauthorized' };
    if (inv.kind === 'join') {
      if (this.activeCount() >= MAX_IDENTITIES) return { error: 'circle_full' };
      this.sql.exec('UPDATE invites SET used_at = ? WHERE token_hash = ?', this.now(), inv.token_hash);
      const r = this.createIdentity(device);
      this.event('joined', r.userId);
      return r;
    }
    // Recuperação: mesmo user_id, aparelho e chaves NOVOS, histórico perdido.
    const rec = this.one('SELECT * FROM recoveries WHERE user_id = ?', inv.for_user);
    if (!rec || rec.state !== 'waiting' || this.now() < rec.wait_until) return { error: 'bad_state' };
    this.sql.exec('UPDATE invites SET used_at = ? WHERE token_hash = ?', this.now(), inv.token_hash);
    this.revokeDevicesOf(inv.for_user);
    const deviceId = this.addDevice(inv.for_user, device);
    this.sql.exec("UPDATE identities SET state = 'active' WHERE user_id = ?", inv.for_user);
    this.sql.exec("UPDATE recoveries SET state = 'done' WHERE user_id = ?", inv.for_user);
    this.event('recovered', inv.for_user); // contatos veem a troca de chave (aviso de segurança)
    return { userId: inv.for_user, deviceId, recovered: true };
  }

  // ---------- sessão por desafio assinado pela chave do aparelho ----------
  challenge(deviceId) {
    const dev = this.one("SELECT * FROM devices WHERE device_id = ? AND state = 'active'", deviceId);
    // Mesmo formato de resposta para aparelho inexistente: não revela quem existe.
    const nonce = randomId(32);
    if (dev) this.sql.exec('INSERT INTO challenges(nonce, device_id, expires_at) VALUES (?, ?, ?)', nonce, deviceId, this.now() + CHALLENGE_TTL);
    this.sql.exec('DELETE FROM challenges WHERE expires_at <= ?', this.now());
    return { nonce };
  }

  async session({ deviceId, nonce, signature }) {
    const ch = this.one('SELECT * FROM challenges WHERE nonce = ? AND device_id = ?', nonce, deviceId);
    if (!ch) return { error: 'unauthorized' };
    this.sql.exec('DELETE FROM challenges WHERE nonce = ?', nonce); // uso único
    if (ch.expires_at <= this.now()) return { error: 'unauthorized' };
    const dev = this.one("SELECT * FROM devices WHERE device_id = ? AND state = 'active'", deviceId);
    if (!dev) return { error: 'unauthorized' };
    const ident = this.identity(dev.user_id);
    if (ident.state === 'frozen') return { error: 'frozen' };
    if (ident.state !== 'active') return { error: 'unauthorized' };
    const key = await crypto.subtle.importKey('raw', unb64(dev.auth_pub), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unb64(signature), new TextEncoder().encode(`mp-auth-v1:${nonce}:${deviceId}`));
    if (!ok) return { error: 'unauthorized' };
    const token = randomId(32);
    this.sql.exec('INSERT INTO sessions(token_hash, device_id, user_id, expires_at) VALUES (?, ?, ?, ?)', await sha256b64(token), deviceId, dev.user_id, this.now() + SESSION_TTL);
    this.sql.exec('DELETE FROM sessions WHERE expires_at <= ?', this.now());
    return { token, userId: dev.user_id, expiresAt: this.now() + SESSION_TTL };
  }

  async authenticate(token) {
    if (typeof token !== 'string' || token.length < 40) return null;
    const s = this.one('SELECT * FROM sessions WHERE token_hash = ?', await sha256b64(token));
    if (!s || s.expires_at <= this.now()) return null;
    const ident = this.identity(s.user_id);
    const dev = this.one('SELECT state FROM devices WHERE device_id = ?', s.device_id);
    if (!ident || ident.state !== 'active' || dev?.state !== 'active') return null;
    return { userId: s.user_id, deviceId: s.device_id, isAdmin: !!ident.is_admin };
  }

  logout(token) { return sha256b64(token).then((h) => { this.sql.exec('DELETE FROM sessions WHERE token_hash = ?', h); return { ok: true }; }); }

  // ---------- diretório mínimo: só ids e chaves públicas, sem apelido ----------
  directory() {
    return this.q(`SELECT i.user_id AS userId, i.joined_seq AS joinedSeq, i.state, d.device_id AS deviceId, d.curve, d.ed
      FROM identities i LEFT JOIN devices d ON d.user_id = i.user_id AND d.state = 'active'
      WHERE i.state != 'removed' ORDER BY i.joined_seq`);
  }

  activeUsers(ids) {
    const set = new Set(this.q("SELECT user_id FROM identities WHERE state = 'active'").map((r) => r.user_id));
    return ids.every((id) => set.has(id));
  }

  // ---------- chaves de uso único ----------
  storeOtks(deviceId, otks) {
    for (const [id, key] of Object.entries(otks).slice(0, MAX_OTKS)) {
      if (!/^[A-Za-z0-9+/=]{1,16}$/.test(id) || !KEY_RE.test(key)) continue;
      this.sql.exec('INSERT OR IGNORE INTO otks(device_id, key_id, key) VALUES (?, ?, ?)', deviceId, id, key);
    }
  }
  storeFallback(deviceId, fb) {
    if (fb && KEY_RE.test(fb.key ?? '') && /^[A-Za-z0-9+/=]{1,16}$/.test(fb.id ?? '')) {
      this.sql.exec('INSERT OR REPLACE INTO fallback_keys(device_id, key_id, key) VALUES (?, ?, ?)', deviceId, fb.id, fb.key);
    }
  }
  uploadKeys(deviceId, { otks, fallback }) {
    if (otks) this.storeOtks(deviceId, otks);
    if (fallback) this.storeFallback(deviceId, fallback);
    return { count: this.one('SELECT count(*) AS n FROM otks WHERE device_id = ?', deviceId).n };
  }
  // Entrega e apaga numa operação só: a mesma chave nunca vai para dois.
  claimKey(targetUserId) {
    const dev = this.activeDevice(targetUserId);
    if (!dev) return { error: 'not_found' };
    const otk = this.one('SELECT key_id, key FROM otks WHERE device_id = ? LIMIT 1', dev.device_id);
    if (otk) this.sql.exec('DELETE FROM otks WHERE device_id = ? AND key_id = ?', dev.device_id, otk.key_id);
    const key = otk ?? this.one('SELECT key_id, key FROM fallback_keys WHERE device_id = ?', dev.device_id);
    if (!key) return { error: 'not_found' };
    return { userId: targetUserId, deviceId: dev.device_id, curve: dev.curve, ed: dev.ed, keyId: key.key_id, key: key.key, fallback: !otk };
  }

  // ---------- troca de aparelho só por QR (V7-015) ----------
  // O aparelho NOVO inicia e mostra o QR; o ANTIGO, autenticado, aprova.
  // Não existe link que adicione aparelho.
  async pairStart({ device }) {
    if (!checkDevice(device)) return { error: 'bad_device' };
    this.sql.exec('DELETE FROM pairings WHERE expires_at <= ?', this.now());
    if (this.one('SELECT count(*) AS n FROM pairings').n > 20) return { error: 'rate_limited' };
    const pairingId = randomId(12);
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 100_000_000).padStart(8, '0');
    this.sql.exec('INSERT INTO pairings(pairing_id, code_hash, auth_pub, curve, ed, keys_json, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      pairingId, await sha256b64(code), device.authPub, device.curve, device.ed,
      JSON.stringify({ otks: device.otks ?? {}, fallback: device.fallback ?? null }).slice(0, 16_000), this.now() + PAIRING_TTL);
    return { pairingId, code, expiresAt: this.now() + PAIRING_TTL };
  }

  async pairApprove(actor, { pairingId, code }) {
    const p = this.one('SELECT * FROM pairings WHERE pairing_id = ?', pairingId);
    if (!p || p.expires_at <= this.now()) return { error: 'not_found' };
    if (p.attempts >= 3) { this.sql.exec('DELETE FROM pairings WHERE pairing_id = ?', pairingId); return { error: 'not_found' }; }
    if (p.code_hash !== await sha256b64(String(code))) {
      this.sql.exec('UPDATE pairings SET attempts = attempts + 1 WHERE pairing_id = ?', pairingId);
      return { error: 'unauthorized' };
    }
    this.sql.exec('DELETE FROM pairings WHERE pairing_id = ?', pairingId);
    // Atômico: novo ativo e antigo revogado na mesma operação (§25.5).
    this.revokeDevicesOf(actor.userId);
    let keys = {};
    try { keys = JSON.parse(p.keys_json); } catch {}
    const deviceId = this.addDevice(actor.userId, { authPub: p.auth_pub, curve: p.curve, ed: p.ed, ...keys });
    this.event('device_changed', actor.userId);
    return { userId: actor.userId, deviceId };
  }

  // O aparelho novo consulta se já foi aprovado (pelo id que só ele conhece).
  pairStatus(pairingId, authPub) {
    const pending = this.one('SELECT 1 FROM pairings WHERE pairing_id = ?', pairingId);
    if (pending) return { state: 'pending' };
    const dev = this.one("SELECT device_id, user_id FROM devices WHERE auth_pub = ? AND state = 'active'", authPub);
    return dev ? { state: 'approved', deviceId: dev.device_id, userId: dev.user_id } : { state: 'expired' };
  }

  // ---------- recuperação após perda do aparelho (V7-012) ----------
  setGuardian(actor, guardian) {
    if (guardian === actor.userId) return { error: 'bad_guardian' };
    const g = this.identity(guardian);
    if (!g || g.state !== 'active') return { error: 'not_found' };
    this.sql.exec('UPDATE identities SET guardian = ? WHERE user_id = ?', guardian, actor.userId);
    return { ok: true };
  }

  // Precisa da administradora E do guardião escolhido antes (ordem livre).
  recoveryApprove(actor, userId) {
    const target = this.identity(userId);
    if (!target || target.state === 'removed') return { error: 'not_found' };
    if (actor.userId === userId) return { error: 'forbidden' };
    const isAdmin = actor.isAdmin, isGuardian = target.guardian === actor.userId;
    if (!isAdmin && !isGuardian) return { error: 'forbidden' };
    let rec = this.one('SELECT * FROM recoveries WHERE user_id = ?', userId);
    if (!rec || ['cancelled', 'done'].includes(rec.state)) {
      this.sql.exec("INSERT OR REPLACE INTO recoveries(user_id, state, created_at) VALUES (?, 'collecting', ?)", userId, this.now());
      rec = this.one('SELECT * FROM recoveries WHERE user_id = ?', userId);
    }
    if (rec.state !== 'collecting') return { error: 'bad_state' };
    if (isAdmin) this.sql.exec('UPDATE recoveries SET by_admin = ? WHERE user_id = ?', actor.userId, userId);
    if (isGuardian) this.sql.exec('UPDATE recoveries SET by_guardian = ? WHERE user_id = ?', actor.userId, userId);
    rec = this.one('SELECT * FROM recoveries WHERE user_id = ?', userId);
    if (rec.by_admin && rec.by_guardian) {
      this.sql.exec("UPDATE recoveries SET state = 'waiting', wait_until = ? WHERE user_id = ?", this.now() + RECOVERY_WAIT, userId);
      this.event('recovery_waiting', userId); // aviso a todos e ao aparelho antigo
    }
    return { state: this.one('SELECT state FROM recoveries WHERE user_id = ?', userId).state };
  }

  // O aparelho antigo, se ainda estiver com a pessoa, cancela.
  recoveryCancel(actor) {
    const rec = this.one('SELECT * FROM recoveries WHERE user_id = ?', actor.userId);
    if (!rec || !['collecting', 'waiting'].includes(rec.state)) return { error: 'not_found' };
    this.sql.exec("UPDATE recoveries SET state = 'cancelled' WHERE user_id = ?", actor.userId);
    this.event('recovery_cancelled', actor.userId);
    return { ok: true };
  }

  // A administradora congela na hora, mas nunca libera antes das 24 h.
  freeze(actor, userId, frozen = true) {
    if (!actor.isAdmin) return { error: 'forbidden' };
    const t = this.identity(userId);
    if (!t || t.state === 'removed') return { error: 'not_found' };
    this.sql.exec('UPDATE identities SET state = ? WHERE user_id = ?', frozen ? 'frozen' : 'active', userId);
    if (frozen) this.sql.exec('DELETE FROM sessions WHERE user_id = ?', userId);
    this.event(frozen ? 'frozen' : 'unfrozen', userId);
    return { ok: true };
  }

  removeIdentity(actor, userId) {
    if (!actor.isAdmin || actor.userId === userId) return { error: 'forbidden' };
    const t = this.identity(userId);
    if (!t || t.state === 'removed') return { error: 'not_found' };
    this.revokeDevicesOf(userId);
    this.sql.exec("UPDATE identities SET state = 'removed' WHERE user_id = ?", userId);
    this.event('removed', userId);
    return { ok: true };
  }

  // ---------- parte do servidor na chave do aparelho (ADR 0014) ----------
  // A chave que abre o banco do aparelho depende de Face ID/digital + PIN +
  // um segredo daqui. O segredo só sai com o PIN certo, e quem conta os erros
  // é o servidor (cópia do aparelho não dá para testar PIN fora daqui).
  // 5 erros, PIN de coação, código de emergência ou aparelho sumido por mais
  // tempo que o combinado: o segredo é apagado e o banco do aparelho morre.
  vaultDay() { return Number(this.env.VAULT_DAY_MS) || DAY; }
  async vaultRegister(actor, { verifier, duress = null, deadDays = 15 }) {
    if (!B64_32.test(verifier ?? '') || (duress !== null && !B64_32.test(duress))) return { error: 'bad_request' };
    if (!DEAD_DAYS.includes(deadDays)) return { error: 'bad_request' };
    const vaultId = randomId(18);
    const share = b64(crypto.getRandomValues(new Uint8Array(32)));
    // Um cofre por aparelho: o anterior (se houver) deixa de abrir.
    this.sql.exec('DELETE FROM vaults WHERE device_id = ?', actor.deviceId);
    this.sql.exec('INSERT INTO vaults(vault_id, user_id, device_id, verifier_hash, duress_hash, share, attempts, last_seen, dead_days) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)',
      vaultId, actor.userId, actor.deviceId, await sha(verifier), duress ? await sha(duress) : null, share, this.now(), deadDays);
    return { vaultId, share };
  }
  async vaultRelease({ vaultId, verifier }) {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(vaultId ?? '') || !B64_32.test(verifier ?? '')) return { error: 'bad_request' };
    this.prune();
    const v = this.one('SELECT * FROM vaults WHERE vault_id = ?', vaultId);
    if (!v) return { error: 'gone' };
    const h = await sha(verifier);
    // PIN de coação: mesma resposta de "apagado" (quem olha não distingue).
    if (v.duress_hash && sameHex(h, v.duress_hash)) { this.vaultKill(v); return { error: 'gone' }; }
    if (!sameHex(h, v.verifier_hash)) {
      const attempts = v.attempts + 1;
      if (attempts >= VAULT_MAX_FAILURES) { this.vaultKill(v); return { error: 'gone' }; }
      this.sql.exec('UPDATE vaults SET attempts = ? WHERE vault_id = ?', attempts, vaultId);
      return { error: 'wrong_secret', left: VAULT_MAX_FAILURES - attempts };
    }
    this.sql.exec('UPDATE vaults SET attempts = 0, last_seen = ? WHERE vault_id = ?', this.now(), vaultId);
    return { share: v.share };
  }
  vaultKill(v) {
    this.sql.exec('DELETE FROM vaults WHERE vault_id = ?', v.vault_id);
    this.revokeDevicesOf(v.user_id); // sessão do aparelho cai junto
    this.event('vault_destroyed', v.user_id);
  }
  vaultSettings(actor, { vaultId, deadDays, duress }) {
    const v = this.one('SELECT * FROM vaults WHERE vault_id = ? AND device_id = ?', vaultId ?? '', actor.deviceId);
    if (!v) return { error: 'not_found' };
    return (async () => {
      if (deadDays !== undefined) {
        if (!DEAD_DAYS.includes(deadDays)) return { error: 'bad_request' };
        this.sql.exec('UPDATE vaults SET dead_days = ?, last_seen = ? WHERE vault_id = ?', deadDays, this.now(), vaultId);
      }
      if (duress !== undefined) {
        if (duress !== null && !B64_32.test(duress)) return { error: 'bad_request' };
        const dh = duress ? await sha(duress) : null;
        if (dh && sameHex(dh, v.verifier_hash)) return { error: 'same_as_pin' }; // coação não pode ser o PIN de verdade
        this.sql.exec('UPDATE vaults SET duress_hash = ? WHERE vault_id = ?', dh, vaultId);
      }
      return { ok: true };
    })();
  }
  // Código de emergência: escrito no papel; de qualquer navegador, mata
  // todos os aparelhos da pessoa (celular perdido ou apreendido).
  async setKillCode(actor, { codeHash }) {
    if (!/^[0-9a-f]{64}$/.test(codeHash ?? '')) return { error: 'bad_request' };
    this.sql.exec('INSERT OR REPLACE INTO kill_codes(user_id, code_hash) VALUES (?, ?)', actor.userId, codeHash);
    return { ok: true };
  }
  async useKillCode({ code }) {
    if (typeof code !== 'string' || code.length < 16 || code.length > 64) return { error: 'bad_request' };
    const h = await sha(code.trim());
    const row = this.q('SELECT user_id, code_hash FROM kill_codes').find((r) => sameHex(r.code_hash, h));
    if (!row) return { ok: true }; // não revela se o código existe
    for (const v of this.q('SELECT * FROM vaults WHERE user_id = ?', row.user_id)) this.vaultKill(v);
    this.revokeDevicesOf(row.user_id);
    return { ok: true };
  }

  // Foto de perfil, foto e fundo de grupo (§21): só a versão atual existe.
  // owner = "u:<userId>" ou "r:<roomId>". Devolve o id anterior para o Worker
  // apagar o objeto na hora.
  visualSwap(owner, slot, mediaId) {
    const old = this.one('SELECT media_id FROM visuals WHERE owner = ? AND slot = ?', owner, slot)?.media_id ?? null;
    if (mediaId) this.sql.exec('INSERT OR REPLACE INTO visuals(owner, slot, media_id) VALUES (?, ?, ?)', owner, slot, mediaId);
    else this.sql.exec('DELETE FROM visuals WHERE owner = ? AND slot = ?', owner, slot);
    return { old };
  }
  visualCurrent(owner, slot) { return this.one('SELECT media_id FROM visuals WHERE owner = ? AND slot = ?', owner, slot)?.media_id ?? null; }
  visualClear(owner) {
    const ids = this.q('SELECT media_id FROM visuals WHERE owner = ?', owner).map((r) => r.media_id);
    this.sql.exec('DELETE FROM visuals WHERE owner = ?', owner);
    return ids;
  }

  securityEvents(afterSeq = 0) {
    return this.q('SELECT seq, at, kind, user_id AS userId FROM security_events WHERE seq > ? ORDER BY seq LIMIT 100', afterSeq);
  }

  // ---------- push ----------
  setPush(deviceId, endpoint) {
    if (endpoint === null) { this.sql.exec('DELETE FROM push_subs WHERE device_id = ?', deviceId); return { ok: true }; }
    let u;
    try { u = new URL(endpoint); } catch { return { error: 'bad_endpoint' }; }
    if (u.protocol !== 'https:') return { error: 'bad_endpoint' };
    this.sql.exec('INSERT OR REPLACE INTO push_subs(device_id, endpoint) VALUES (?, ?)', deviceId, endpoint);
    return { ok: true };
  }
  pushTargetsByUser(userIds) {
    const out = {};
    if (!userIds.length) return out;
    const rows = this.q(`SELECT d.user_id, p.endpoint FROM push_subs p JOIN devices d ON d.device_id = p.device_id
      WHERE d.state = 'active' AND d.user_id IN (${userIds.map(() => '?').join(',')})`, ...userIds);
    for (const r of rows) (out[r.user_id] ??= []).push(r.endpoint);
    return out;
  }
  dropPushEndpoints(endpoints) {
    for (const e of endpoints) this.sql.exec('DELETE FROM push_subs WHERE endpoint = ?', e);
    return { ok: true };
  }
  pushTargets(userIds) {
    if (!userIds.length) return [];
    return this.q(`SELECT p.endpoint FROM push_subs p JOIN devices d ON d.device_id = p.device_id
      WHERE d.state = 'active' AND d.user_id IN (${userIds.map(() => '?').join(',')})`, ...userIds).map((r) => r.endpoint);
  }
}
