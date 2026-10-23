// Núcleo do cliente: identidade do aparelho, sessões Olm por pessoa
// (fan-out, V7-002), envio, sincronização e regras de exibição.
//
// Regras que este arquivo garante:
// - estado do ratchet salvo ANTES de transmitir (§51);
// - o remetente declarado na mensagem cifrada precisa ser o mesmo que o
//   servidor autenticou; senão a mensagem é descartada (anti-falsificação);
// - troca de chave de alguém vira aviso de segurança, nunca silêncio (§7);
// - nada aparece sem tempo confiável; apagadas e vencidas somem antes (§25.6).
import { OlmAccount, OlmSession, sealOuter, parseOuter, b64, unb64 } from '../../crypto/index.js';
import { encodeInner, decodeInner, INNER_VERSION } from '../../protocol/src/envelope.js';
import { reconcile, applyEdit } from '../../protocol/src/reconcile.js';
import { encryptMedia, decryptMedia, newMediaKey } from './media-crypto.js';

const OTK_BATCH = 20;
const OTK_LOW = 5;
const newMsgId = () => b64(crypto.getRandomValues(new Uint8Array(12))).replace(/\+/g, '-').replace(/\//g, '_');

export class MessengerClient {
  // onDestroy(ids): chamado sempre que algo é apagado no aparelho, para o app
  // reconstruir o banco com chave nova (os restos antigos ficam ilegíveis).
  constructor({ api, store, pickleKey, onDestroy = () => {} }) {
    if (!(pickleKey instanceof Uint8Array) || pickleKey.byteLength !== 32) throw new Error('pickleKey de 32 bytes');
    this.api = api;
    this.store = store;
    this.pickleKey = pickleKey;
    this.sessions = new Map(); // userId -> [OlmSession] (mais nova primeiro)
    this.warnings = [];
    this.known = {};
    this.hidden = new Map(); // msgId -> quando (apagado para mim)
    this.tombs = new Map(); // msgId -> quando (apagado para todos)
    this.onDestroy = onDestroy;
  }

  // ---------- identidade do aparelho ----------
  async createDevice() {
    const authKey = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
    const account = new OlmAccount();
    account.generateOneTimeKeys(OTK_BATCH);
    account.generateFallbackKey();
    const otks = JSON.parse(account.oneTimeKeys());
    const [fbId, fbKey] = Object.entries(JSON.parse(account.fallbackKey()))[0];
    const pub = {
      authPub: b64(new Uint8Array(await crypto.subtle.exportKey('raw', authKey.publicKey))),
      curve: account.curve25519Key, ed: account.ed25519Key, otks, fallback: { id: fbId, key: fbKey },
    };
    this.account = account;
    this.authKey = authKey;
    return pub;
  }

  async saveDevice() {
    // Conta Olm marcada como publicada e salva antes de qualquer uso.
    this.account.markKeysAsPublished();
    await this.store.put('device', { userId: this.userId, deviceId: this.deviceId, authKey: this.authKey, account: this.account.pickle(this.pickleKey) });
  }

  async bootstrap(setupCode) {
    const device = await this.createDevice();
    const r = await this.api.post('/v1/bootstrap', { setupCode, device });
    Object.assign(this, { userId: r.userId, deviceId: r.deviceId });
    await this.saveDevice();
    return r;
  }

  async redeem(token) {
    const device = await this.createDevice();
    const r = await this.api.post('/v1/invites/redeem', { token, device });
    Object.assign(this, { userId: r.userId, deviceId: r.deviceId });
    await this.saveDevice();
    return r;
  }

  async open() {
    const dev = await this.store.get('device');
    if (!dev) throw new Error('aparelho sem identidade');
    this.userId = dev.userId; this.deviceId = dev.deviceId; this.authKey = dev.authKey;
    this.account = OlmAccount.fromPickle(dev.account, this.pickleKey);
    const saved = (await this.store.get('sessions')) ?? {};
    for (const [peer, list] of Object.entries(saved)) this.sessions.set(peer, list.map((p) => OlmSession.fromPickle(p, this.pickleKey)));
    this.known = (await this.store.get('directory')) ?? {};
    this.hidden = new Map(Object.entries((await this.store.get('hiddenForMe')) ?? {}));
    this.tombs = new Map(Object.entries((await this.store.get('tombstones')) ?? {}));
  }

  async login() {
    const { nonce } = await this.api.post('/v1/auth/challenge', { deviceId: this.deviceId });
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, this.authKey.privateKey, new TextEncoder().encode(`mp-auth-v1:${nonce}:${this.deviceId}`));
    const r = await this.api.post('/v1/auth/session', { deviceId: this.deviceId, nonce, signature: b64(new Uint8Array(sig)) });
    this.api.token = r.token;
    return r;
  }

  async persistCrypto() {
    const out = {};
    for (const [peer, list] of this.sessions) out[peer] = list.slice(0, 3).map((s) => s.pickle(this.pickleKey));
    await this.store.put('sessions', out);
    await this.store.put('device', { userId: this.userId, deviceId: this.deviceId, authKey: this.authKey, account: this.account.pickle(this.pickleKey) });
  }

  // ---------- diretório e avisos de troca de chave ----------
  async refreshDirectory() {
    const { members } = await this.api.get('/v1/directory');
    for (const m of members) {
      const prev = this.known[m.userId];
      if (prev && m.curve && prev.curve !== m.curve) {
        // Chave nova = aparelho novo ou recuperação. Aviso explícito; sessões
        // antigas com essa pessoa deixam de valer.
        this.warnings.push({ kind: 'key_changed', userId: m.userId, at: this.api.clock.now() });
        this.sessions.delete(m.userId);
      }
      if (m.curve) this.known[m.userId] = { curve: m.curve, ed: m.ed, deviceId: m.deviceId };
    }
    await this.store.put('directory', this.known);
    await this.persistCrypto();
    return members;
  }

  async sessionFor(userId) {
    const list = this.sessions.get(userId);
    if (list?.length) return list[0];
    const k = await this.api.post('/v1/keys/claim', { userId });
    const known = this.known[userId];
    if (!known || known.curve !== k.curve) throw new Error('chave do destinatário diferente da conhecida: confira a identidade');
    const s = this.account.createOutboundSession(k.curve, k.key);
    this.sessions.set(userId, [s]);
    return s;
  }

  async replenishKeys() {
    this.account.generateOneTimeKeys(OTK_BATCH);
    const otks = JSON.parse(this.account.oneTimeKeys());
    this.account.markKeysAsPublished();
    await this.persistCrypto();
    return this.api.post('/v1/keys', { otks });
  }

  // ---------- conversas ----------
  createRoom(kind, members, ttls = {}) { return this.api.post('/v1/rooms', { kind, members, ...ttls }); }
  room(roomId) { return this.api.get(`/v1/rooms/${roomId}`); }
  roomEvent(roomId, ev) { return this.api.post(`/v1/rooms/${roomId}/events`, ev); }

  // Envia qualquer tipo de conteúdo interno a todos os membros ativos.
  async sendInner(roomId, kind, body, { replyTo, msgKind = 'text' } = {}) {
    const room = await this.room(roomId);
    const to = room.members.filter((m) => m.active && m.userId !== this.userId).map((m) => m.userId);
    const msgId = newMsgId();
    const inner = { v: INNER_VERSION, kind, msgId, room: roomId, sender: this.userId, policyRev: room.policyRev, body };
    if (replyTo) inner.replyTo = replyTo;
    const bytes = encodeInner(inner);
    const envelopes = {};
    for (const u of to) envelopes[u] = sealOuter(await this.sessionFor(u), bytes);
    await this.persistCrypto(); // ratchet salvo antes de transmitir
    const r = await this.api.post(`/v1/rooms/${roomId}/messages`, { msgId, kind: msgKind, envelopes });
    const local = { msgId, room: roomId, sender: this.userId, kind, body, replyTo, acceptedAt: r.acceptedAt, expiresAt: r.expiresAt, mine: true };
    if (kind === 'text' || kind === 'media') await this.store.putMessage({ ...local, text: body.text });
    return local;
  }

  sendText(roomId, text, opts) { return this.sendInner(roomId, 'text', { text }, opts); }
  react(roomId, target, emoji) { return this.sendInner(roomId, 'reaction', { target, emoji }); }

  async edit(roomId, target, text) {
    const orig = await this.store.getMessage(target);
    if (!orig || orig.sender !== this.userId) throw new Error('só o autor edita');
    const version = (orig.editVersion ?? 0) + 1;
    await this.store.putMessage(applyEdit(orig, { sender: this.userId, body: { target, text, version } }));
    return this.sendInner(roomId, 'edit', { target, text, version });
  }

  // Marcas de apagado só precisam durar o prazo máximo de uma mensagem
  // (15 dias); depois disso nem o id da mensagem apagada fica guardado.
  static MARK_TTL = 16 * 86_400_000;
  prune(map, now = Date.now()) {
    for (const [id, at] of map) if (now - at > MessengerClient.MARK_TTL) map.delete(id);
    return Object.fromEntries(map);
  }
  async saveMarks() {
    await this.store.put('tombstones', this.prune(this.tombs));
    await this.store.put('hiddenForMe', this.prune(this.hidden));
  }
  async destroy(ids) {
    if (!ids.length) return;
    await this.store.deleteMessages(ids);
    await this.onDestroy(ids);
  }

  async deleteForAll(roomId, msgId) {
    await this.api.post(`/v1/rooms/${roomId}/messages/${msgId}/delete`);
    this.tombs.set(msgId, Date.now());
    await this.saveMarks();
    await this.destroy([msgId]);
  }

  async deleteForMe(msgId) {
    this.hidden.set(msgId, Date.now());
    await this.saveMarks();
    await this.destroy([msgId]);
  }

  // ---------- mídia ----------
  async sendMedia(roomId, bytes, { mode = 'media', mime = 'application/octet-stream', caption } = {}) {
    const key = await newMediaKey();
    const blob = await encryptMedia(key, bytes);
    const up = await this.api.post(`/v1/rooms/${roomId}/media?mode=${mode}`, blob);
    // A chave vai só dentro do envelope Olm de cada destinatário.
    const body = { mediaId: up.mediaId, key: b64(key), mime, mode, size: bytes.byteLength, ...(caption ? { caption } : {}) };
    key.fill(0);
    const msg = await this.sendInner(roomId, 'media', body, { msgKind: 'media' });
    if (mode === 'once') {
      // Quem enviou não reabre (§15.6): a chave não fica nem no aparelho dele.
      const stored = await this.store.getMessage(msg.msgId);
      if (stored) await this.store.putMessage({ ...stored, body: { ...stored.body, key: null }, consumed: true });
      msg.body = { ...msg.body, key: null };
      await this.onDestroy([]);
    }
    if (mode === 'doc') msg.quota = await this.api.post('/v1/docs/publish', { mediaId: up.mediaId, msgId: msg.msgId });
    return msg;
  }

  async openMedia(msg) {
    if (!msg.body?.key) throw new Error('mídia sem chave neste aparelho (já vista ou enviada por você)');
    const once = msg.body.mode === 'once';
    const forget = async () => {
      // Ver uma vez: depois da tentativa (dê certo ou não), a chave some do
      // aparelho e o banco é refeito sem ela (ADR 0012).
      const stored = await this.store.getMessage(msg.msgId);
      if (stored) await this.store.putMessage({ ...stored, body: { ...stored.body, key: null }, consumed: true });
      await this.onDestroy([]);
    };
    let blob;
    try { blob = await this.api.post(`/v1/media/${msg.body.mediaId}/open`, undefined, { binary: true }); }
    catch (e) { if (once && [404, 410].includes(e.status)) await forget(); throw e; }
    const key = unb64(msg.body.key);
    try { return await decryptMedia(key, blob); } finally { key.fill(0); if (once) await forget(); }
  }

  // ---------- sincronização ----------
  async decryptFrom(sender, type, body) {
    const list = this.sessions.get(sender) ?? [];
    for (const s of list) {
      try { return s.decrypt(type, body); } catch {}
    }
    if (type !== 0) throw new Error('sem sessão para esta mensagem');
    const known = this.known[sender];
    if (!known) throw new Error('remetente desconhecido');
    // A identidade no pre-key precisa ser a do diretório (createInboundSession confere).
    const r = this.account.createInboundSession(known.curve, type, body);
    const pt = r.takePlaintext();
    this.sessions.set(sender, [r.takeSession(), ...list]);
    r.free();
    return pt;
  }

  async sync() {
    const res = await this.api.get('/v1/sync');
    const acks = { envelopes: [], tombstones: [] };
    // 1) tombstones primeiro: nada apagado chega a aparecer (§12).
    for (const t of res.tombstones) {
      this.tombs.set(t.msgId, Date.now());
      acks.tombstones.push([t.room, t.msgId]);
    }
    await this.destroy(res.tombstones.map((t) => t.msgId));
    const received = [], rejected = [];
    for (const e of res.envelopes) {
      acks.envelopes.push([e.room, e.msgId]);
      if (this.tombs.has(e.msgId)) continue;
      if (!this.known[e.sender]) await this.refreshDirectory();
      try {
        const { type, body } = parseOuter(e.ct);
        const inner = decodeInner(await this.decryptFrom(e.sender, type, body));
        // Anti-falsificação: o que está dentro tem que bater com o que o
        // servidor autenticou (remetente, conversa e id).
        if (inner.sender !== e.sender || inner.room !== e.room || inner.msgId !== e.msgId) throw new Error('remetente ou conversa não conferem');
        await this.apply(inner, e);
        received.push(inner);
      } catch (err) {
        rejected.push({ msgId: e.msgId, sender: e.sender, reason: String(err.message || err) });
      }
    }
    await this.persistCrypto(); // estado salvo antes de confirmar
    await this.saveMarks();
    if (acks.envelopes.length || acks.tombstones.length) await this.api.post('/v1/ack', acks);
    return { received, rejected, tombstones: res.tombstones.length, more: res.more };
  }

  async apply(inner, e) {
    const base = { msgId: inner.msgId, room: inner.room, sender: inner.sender, acceptedAt: e.acceptedAt, expiresAt: e.expiresAt, replyTo: inner.replyTo };
    switch (inner.kind) {
      case 'text': return this.store.putMessage({ ...base, kind: 'text', text: inner.body.text });
      case 'media': return this.store.putMessage({ ...base, kind: 'media', body: inner.body });
      case 'edit': {
        const orig = await this.store.getMessage(inner.body.target);
        if (orig) await this.store.putMessage(applyEdit(orig, inner)); // applyEdit exige o mesmo autor
        return;
      }
      case 'reaction': {
        const orig = await this.store.getMessage(inner.body.target);
        if (orig) await this.store.putMessage({ ...orig, reactions: { ...(orig.reactions ?? {}), [inner.sender]: inner.body.emoji } });
        return;
      }
      default: return; // outros tipos são tratados pela interface (política etc.)
    }
  }

  // O que pode aparecer agora, depois de aplicar tudo (§25.6).
  async view(roomId) {
    const messages = await this.store.roomMessages(roomId);
    const r = reconcile({ messages, tombstones: this.tombs, hiddenForMe: this.hidden, trustedNow: this.api.clock.now() });
    await this.destroy(r.destroy);
    return r;
  }
}
