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
import { reconcile, applyEdit, EDIT_WINDOW_MS, EDIT_GRACE_MS } from '../../protocol/src/reconcile.js';
import { CIRCLE_ROOM_ID } from '../../protocol/src/room.js';
import { isValidTtl, MAX_TTL } from '../../protocol/src/ttl.js';
import { encryptMedia, decryptMedia, newMediaKey } from './media-crypto.js';
import { serial } from './serial.js';

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
    // Membros confirmados por conversa, só mudados por anúncio cifrado da
    // líder. O servidor não consegue incluir um "membro fantasma" (V7-014 nº 1).
    this.trusted = {};
    // S8: quem foi conferido pessoalmente (userId -> chave conferida).
    this.verified = {};
    this.stateWork = serial();
    this.outboxWork = serial();
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
    this.circleAdmin = this.userId;
    this.circleAdminKey = this.account.curve25519Key;
    this.trusted[CIRCLE_ROOM_ID] = { members: [this.userId], leader: this.userId, revision: 0, adminCurve: this.circleAdminKey };
    await this.store.put('circleAdmin', this.circleAdmin);
    await this.store.put('circleAdminKey', this.circleAdminKey);
    await this.store.put('trusted', this.trusted);
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
    this.trusted = (await this.store.get('trusted')) ?? {};
    this.hidden = new Map(Object.entries((await this.store.get('hiddenForMe')) ?? {}));
    this.tombs = new Map(Object.entries((await this.store.get('tombstones')) ?? {}));
    // S1: avisos de segurança ficam no banco cifrado (antes sumiam ao fechar).
    this.warnings = (await this.store.get('warnings')) ?? [];
    this.verified = (await this.store.get('verified')) ?? {};
    this.circleAdmin = (await this.store.get('circleAdmin')) ?? null;
    this.circleAdminKey = (await this.store.get('circleAdminKey')) ?? null;
  }

  // ---------- círculo confirmado pela administradora (S3) ----------
  // A administradora é quem criou o círculo (primeira identidade). Fica
  // fixada no aparelho na primeira vez; o servidor não consegue trocá-la.
  async circleAdminId() {
    if (this.circleAdmin) {
      if (!this.circleAdminKey && this.known[this.circleAdmin]?.curve) {
        this.circleAdminKey = this.known[this.circleAdmin].curve;
        await this.store.put('circleAdminKey', this.circleAdminKey);
      }
      return this.circleAdmin;
    }
    const first = Object.entries(this.known).filter(([, k]) => Number.isSafeInteger(k.joinedSeq)).sort((a, b) => a[1].joinedSeq - b[1].joinedSeq)[0];
    if (!first || first[1].joinedSeq !== 0) return null;
    this.circleAdmin = first[0];
    await this.store.put('circleAdmin', this.circleAdmin);
    this.circleAdminKey = first[1].curve;
    await this.store.put('circleAdminKey', this.circleAdminKey);
    return this.circleAdmin;
  }
  circleRoster() {
    if (!this.circleAdminKey || this.known[this.circleAdmin]?.curve !== this.circleAdminKey) return null;
    return this.trusted[CIRCLE_ROOM_ID]?.members ?? null;
  }
  // Só a administradora: confirma (assina, cifrado) quem está no círculo.
  confirmCircle(members) { return this.stateWork(() => this._confirmCircle(members)); }
  async _confirmCircle(members) {
    if ((await this.circleAdminId()) !== this.userId) throw new Error('só a administradora confirma o círculo');
    const list = [this.userId, ...new Set(members.filter((u) => u !== this.userId))];
    if (list.some((u) => this.known[u]?.state !== 'active')) throw new Error('pessoa não está ativa no círculo');
    const revision = (this.trusted[CIRCLE_ROOM_ID]?.revision ?? 0) + 1;
    this.trusted[CIRCLE_ROOM_ID] = { members: list, leader: this.userId, revision, adminCurve: this.account.curve25519Key };
    await this.store.put('trusted', this.trusted);
    await this._sendInner(CIRCLE_ROOM_ID, 'membership', { members: list, leader: this.userId, revision });
  }

  // ---------- avisos de segurança (S1) e verificação (S8) ----------
  static WARN_TTL = 30 * 86_400_000;
  warn(w) { this.warnings.push(w); this.warningsDirty = true; }
  async saveWarnings() {
    if (!this.warningsDirty) return;
    const now = this.api.clock.now() ?? Date.now();
    this.warnings = this.warnings.filter((w) => now - (w.at ?? now) < MessengerClient.WARN_TTL).slice(-200);
    await this.store.put('warnings', this.warnings);
    this.warningsDirty = false;
  }
  assertMediaAllowed(to) {
    const changed = to.filter((u) => this.keyChangedSinceVerified(u));
    if (changed.length) { const e = new Error('a chave de alguém que vocês conferiram mudou: confiram de novo antes de mandar mídia'); e.code = 'key_unverified'; e.userIds = changed; throw e; }
  }
  isVerified(userId) { return !!this.verified[userId] && this.verified[userId] === this.known[userId]?.curve; }
  // Conferido e depois trocou de chave: o envio de mídia pausa até conferir
  // de novo ou aceitar a chave nova.
  keyChangedSinceVerified(userId) { return !!this.verified[userId] && this.verified[userId] !== this.known[userId]?.curve; }
  setVerified(userId, on, expected = null) { return this.stateWork(() => this._setVerified(userId, on, expected)); }
  async _setVerified(userId, on, expected) {
    if (expected && (expected.curve !== this.known[userId]?.curve || expected.own !== this.account.curve25519Key)) throw new Error('chave alterada durante a conferência');
    if (on) {
      if (!this.known[userId]?.curve) throw new Error('chave desconhecida');
      this.verified[userId] = this.known[userId].curve;
    } else delete this.verified[userId];
    if (on && userId === this.circleAdmin && this.circleAdminKey !== this.known[userId].curve) {
      this.circleAdminKey = this.known[userId].curve;
      delete this.trusted[CIRCLE_ROOM_ID];
      await this.store.put('circleAdminKey', this.circleAdminKey);
      await this.store.put('trusted', this.trusted);
    }
    await this.store.put('verified', this.verified);
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
  refreshDirectory() { return this.stateWork(() => this._refreshDirectory()); }
  async _refreshDirectory() {
    // Fixa a chave anterior antes de processar uma mudança do diretório.
    await this.circleAdminId();
    const { members } = await this.api.get('/v1/directory');
    for (const m of members) {
      const prev = this.known[m.userId];
      if (prev && m.curve && prev.curve !== m.curve) {
        // Chave nova = aparelho novo ou recuperação. Aviso explícito; sessões
        // antigas com essa pessoa deixam de valer.
        this.warn({ kind: 'key_changed', userId: m.userId, at: this.api.clock.now() ?? Date.now(), verified: !!this.verified[m.userId] });
        this.sessions.delete(m.userId);
      }
      if (m.curve) this.known[m.userId] = { curve: m.curve, ed: m.ed, deviceId: m.deviceId, joinedSeq: m.joinedSeq, state: m.state };
    }
    // Quem saiu do círculo continua conhecido (avisos antigos), mas marcado.
    const listed = new Set(members.map((m) => m.userId));
    for (const [u, k] of Object.entries(this.known)) if (!listed.has(u)) k.state = 'removed';
    await this.store.put('directory', this.known);
    await this.circleAdminId();
    await this.persistCrypto();
    await this.saveWarnings();
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
  async createRoom(kind, members, ttls = {}) {
    const view = await this.api.post('/v1/rooms', { kind, members, ...ttls, ...(kind === 'direct' ? { reuse: true } : {}) });
    const selected = new Set([this.userId, ...members]);
    if (view.kind !== kind || view.closed || !selected.has(view.leader) || view.members.length !== selected.size || new Set(view.members.map(m => m.userId)).size !== selected.size || view.members.some(m => !m.active || !selected.has(m.userId))) throw new Error('membros retornados diferentes dos escolhidos: criação recusada');
    if (view.created !== false && view.leader !== this.userId) throw new Error('líder da conversa criada não confere');
    if (kind === 'direct' && view.created === false) {
      const expected = new Set([this.userId, ...members]);
      if (view.kind !== 'direct' || view.closed || view.members.length !== 2 || view.members.some((m) => !m.active || !expected.has(m.userId))) throw new Error('conversa retornada não confere');
      // Reaproveitar não torna quem abriu a líder. Só aceita confiança já
      // existente ou o anúncio cifrado original recebido na sincronização.
      if (view.leader === this.userId && (!this.trusted[view.roomId] || this.trusted[view.roomId].leader === this.userId)) {
        this.trusted[view.roomId] ??= { members: [...expected], leader: this.userId };
        await this.store.put('trusted', this.trusted);
        await this.announceMembership(view.roomId, view);
      }
      return view;
    }
    // Quem cria escolheu os membros: confirma localmente e anuncia cifrado.
    this.trusted[view.roomId] = { members: [this.userId, ...members.filter((m) => m !== this.userId)], leader: this.userId };
    await this.store.put('trusted', this.trusted);
    await this.announceMembership(view.roomId, view);
    return view;
  }

  // A líder anuncia (cifrado) quem está na conversa e quem lidera. Chamar
  // depois de criar, adicionar, remover, ceder liderança ou antes de sair.
  announceMembership(...args) { return this.stateWork(() => this._announceMembership(...args)); }
  async _announceMembership(roomId, view = null, { leaving = false } = {}) {
    view ??= await this.room(roomId);
    let members = view.members.filter((m) => m.active).sort((a, b) => a.joinSeq - b.joinSeq).map((m) => m.userId);
    let leader = view.leader;
    if (leaving) { members = members.filter((u) => u !== this.userId); leader = members[0]; }
    if (!members.length) return;
    this.trusted[roomId] = { members, leader };
    await this.store.put('trusted', this.trusted);
    if (members.some((u) => u !== this.userId) || leaving) await this._sendInner(roomId, 'membership', { members: leaving ? [...members] : members, leader }, { view });
  }

  // Confere o que o servidor diz contra o que foi confirmado de ponta a ponta.
  checkRecipients(roomId, view, to) {
    if (roomId === CIRCLE_ROOM_ID) return; // conversa do círculo: membros = círculo
    const t = this.trusted[roomId];
    if (view.kind === 'direct' && (view.members.length !== 2 || !view.members.some((m) => m.userId === this.userId))) {
      throw new Error('conversa 1:1 com membros estranhos: envio recusado');
    }
    if (!t) throw new Error('membros desta conversa ainda não confirmados pela líder: aguarde a sincronização');
    const extra = to.filter((u) => !t.members.includes(u));
    if (extra.length) {
      this.warn({ kind: 'unconfirmed_member', roomId, userIds: extra, at: this.api.clock.now() });
      throw new Error('o servidor indicou alguém que a líder não anunciou: envio recusado por segurança');
    }
  }
  room(roomId) { return this.api.get(`/v1/rooms/${roomId}`); }
  roomEvent(roomId, ev) { return this.api.post(`/v1/rooms/${roomId}/events`, ev); }

  // Envia qualquer tipo de conteúdo interno a todos os membros ativos.
  sendInner(...args) { return this.stateWork(() => this._sendInner(...args)); }
  async _sendInner(roomId, kind, body, { replyTo, msgKind = 'text', view = null, audience = null, ttl, mediaId, localBody = null, queueId = null } = {}) {
    // Os dois pedidos vão juntos (menos idas e voltas em rede lenta, ex.: Tor);
    // a conferência de segurança termina antes de qualquer cifra.
    const [, room] = await Promise.all([
      this._checkSecurityEvents(), // nunca cifrar para uma chave que já foi trocada
      view ?? this.room(roomId),
    ]);
    let to = room.members.filter((m) => m.active && m.userId !== this.userId).map((m) => m.userId);
    if (audience) {
      // Story: só para quem a pessoa escolheu, e só gente do círculo.
      if (!audience.length || audience.some((u) => !to.includes(u))) throw new Error('audiência inválida');
      to = [...new Set(audience)];
    }
    // S3: no círculo com lista confirmada, quem a administradora não confirmou
    // recebe um envelope de enchimento (o servidor exige um por membro e não
    // distingue); só os confirmados recebem conteúdo.
    let decoys = [];
    if (roomId === CIRCLE_ROOM_ID && !audience) {
      const admin = await this.circleAdminId();
      const pinned = this.circleAdminKey === this.known[admin]?.curve;
      // Antes da aprovação, só o próprio perfil pode ir à administradora
      // fixada, para ela identificar o pedido. Nunca vai aos demais membros.
      const roster = this.circleRoster() ?? (kind === 'nickname_change' && this.userId !== admin && pinned ? [admin] : []);
      decoys = to.filter((u) => !roster.includes(u));
      to = to.filter((u) => roster.includes(u));
      if (decoys.length) {
        const key = [...decoys].sort().join(',');
        const last = [...this.warnings].reverse().find((w) => w.kind === 'unconfirmed_circle');
        if (!last || last.userIds?.slice().sort().join(',') !== key) this.warn({ kind: 'unconfirmed_circle', userIds: decoys, at: this.api.clock.now() ?? Date.now() });
      }
    }
    if (kind !== 'membership') this.checkRecipients(roomId, room, to);
    else if (to.some((u) => !this.trusted[roomId]?.members.includes(u))) throw new Error('anúncio para quem não está confirmado: recusado');
    if (msgKind !== 'text') this.assertMediaAllowed(to);
    const msgId = queueId ?? newMsgId();
    const inner = { v: INNER_VERSION, kind, msgId, room: roomId, sender: this.userId, policyRev: room.policyRev, body };
    const expect = ttl ?? (msgKind === 'media' ? room.mediaTtl : room.textTtl);
    if (isValidTtl(expect)) inner.ttl = expect;
    if (replyTo) inner.replyTo = replyTo;
    const bytes = encodeInner(inner);
    const envelopes = {};
    for (const u of to) envelopes[u] = sealOuter(await this.sessionFor(u), bytes);
    const fillLen = Object.values(envelopes)[0]?.length ?? 400;
    for (const u of decoys) envelopes[u] = b64(crypto.getRandomValues(new Uint8Array(Math.floor(fillLen * 3 / 4))));
    await this.persistCrypto(); // ratchet salvo antes de transmitir
    // F10: o envelope já cifrado fica na fila (banco cifrado) antes de sair.
    // Se a rede cair sem resposta, a nova tentativa reenvia O MESMO id e o
    // mesmo envelope: o servidor reconhece e não duplica.
    const payload = { msgId, kind: msgKind, envelopes, ...(ttl ? { ttl } : {}), ...(mediaId ? { mediaId } : {}) };
    const draft = { msgId, room: roomId, sender: this.userId, kind, body: localBody ?? body, replyTo, mine: true, ...(localBody ? { consumed: true } : {}) };
    const stored = ['text', 'media', 'story', 'poll'].includes(kind);
    await this.queue(roomId, payload, stored ? draft : null);
    return this._deliver(roomId, msgId);
  }

  // ---------- fila de envio (F10) ----------
  static OUTBOX_TTL = 15 * 86_400_000;
  async outbox() { return structuredClone((await this.store.get('outbox')) ?? []); }
  async queue(roomId, payload, local) {
    return this.outboxWork(async () => {
      const all = await this.outbox();
      const existing = all.find((o) => o.payload.msgId === payload.msgId);
      await this.store.put('outbox', [...all.filter((o) => o !== existing), { ...existing, roomId, payload, local, at: existing?.at ?? Date.now(), state: 'ready' }]);
    });
  }
  async updateQueued(msgId, patch) {
    return this.outboxWork(async () => {
      const all = await this.outbox();
      await this.store.put('outbox', all.map((o) => o.payload.msgId === msgId ? { ...o, ...patch } : o));
    });
  }
  dequeue(msgId) { return this.outboxWork(async () => { await this.store.put('outbox', (await this.outbox()).filter((o) => o.payload.msgId !== msgId)); }); }
  deliver(...args) { return this.stateWork(() => this._deliver(...args)); }
  async _deliver(roomId, msgId) {
    const item = (await this.outbox()).find((o) => o.payload.msgId === msgId);
    if (!item) {
      // A sincronização pode ter concluído este envio entre dois itens do
      // lote. A confirmação local torna deliver repetível também nesse caso.
      const accepted = await this.store.getMessage(msgId);
      if (accepted?.room === roomId && accepted.sender === this.userId) return structuredClone(accepted);
      throw new Error('envio não encontrado');
    }
    let r;
    try {
      if (item.state === 'staging') throw Object.assign(new Error('preparação interrompida'), { status: 400, code: 'incomplete_upload' });
      if (item.state === 'prepared') return await this.uploadPrepared(item);
      // mediaId liga a mensagem à mídia (F04/F16): apagar para todos revoga no
      // servidor, e o documento entra na cota no mesmo envio.
      r = await this.api.post(`/v1/rooms/${roomId}/messages`, item.payload);
    } catch (e) {
      if (e.code === 'pending' || e.code === 'send_failed') throw e;
      const temporary = !e.status && !['key_unverified', 'incomplete_upload'].includes(e.code) || [401, 408, 425, 429, 500, 502, 503, 504].includes(e.status);
      const attempts = (item.attempts ?? 0) + 1;
      if (!temporary) {
        await this.updateQueued(msgId, { state: 'failed', error: e.code || 'send_failed', cleanupPending: !!item.prepared });
        try { await this.cleanupUpload(item); await this.updateQueued(msgId, { cleanupPending: false }); } catch { /* laço de sync repete */ }
        if (e.code !== 'key_unverified') e.code = 'send_failed';
        e.msgId = msgId;
        throw e;
      }
      await this.updateQueued(msgId, { attempts, nextTryAt: Date.now() + Math.max(e.retryAfterMs ?? 0, Math.min(60_000, 1000 * 2 ** Math.min(attempts - 1, 6))) });
      const p = new Error('sem conexão: a mensagem fica na fila e vai sozinha quando a rede voltar');
      p.code = 'pending'; p.msgId = msgId;
      throw p;
    }
    const local = item.local ? { ...item.local, acceptedAt: r.acceptedAt, expiresAt: r.expiresAt } : { msgId, room: roomId, acceptedAt: r.acceptedAt, expiresAt: r.expiresAt };
    if (item.local) await this.store.putMessage({ ...local, text: local.body?.text });
    await this.eraseUpload(item);
    await this.dequeue(msgId);
    if (r.quota) local.quota = r.quota;
    return local;
  }
  // Tenta de novo o que ficou na fila. Devolve o que foi e o que falhou.
  retryOutbox(options) { return this.stateWork(() => this._retryOutbox(options)); }
  async _retryOutbox({ force = false } = {}) {
    const out = { sent: [], failed: [] };
    for (const item of await this.outbox()) {
      if (item.cleanupPending) { try { await this.cleanupUpload(item); await this.updateQueued(item.payload.msgId, { cleanupPending: false }); } catch {} }
      if (item.state === 'cancelled') { try { await this._cancelQueued(item.payload.msgId); } catch {} continue; }
      if (Date.now() - item.at > MessengerClient.OUTBOX_TTL) { await this._cancelQueued(item.payload.msgId); out.failed.push(item); continue; }
      if (item.state === 'failed' || (!force && item.nextTryAt > Date.now())) continue;
      try { out.sent.push(await this._deliver(item.roomId, item.payload.msgId)); }
      catch (e) { if (e.code === 'pending') break; out.failed.push(item); this.warn({ kind: 'send_failed', roomId: item.roomId, at: Date.now() }); }
    }
    return out;
  }

  sendText(roomId, text, opts) { return this.sendInner(roomId, 'text', { text }, opts); }

  // ---------- enquete (D), fixar (C) e favoritas (C) ----------
  sendPoll(roomId, question, options, multi = false) {
    return this.sendInner(roomId, 'poll', { question: question.trim(), options: options.map((o) => o.trim()).filter(Boolean), multi: !!multi });
  }
  async vote(roomId, target, choices) {
    await this.sendInner(roomId, 'vote', { target, choices });
    const orig = await this.store.getMessage(target);
    if (orig?.kind === 'poll') await this.store.putMessage({ ...orig, votes: { ...(orig.votes ?? {}), [this.userId]: choices } });
  }
  // Fixar mensagem na conversa (até 3, como no WhatsApp). until = 0 desafixa.
  async pin(roomId, target, until) {
    await this.sendInner(roomId, 'pin', { target, until });
    await this.applyPin({ room: roomId, sender: this.userId, body: { target, until } });
  }
  async pinsOf(roomId) {
    const now = this.api.clock.now() ?? Date.now();
    const all = (await this.store.get('pins')) ?? {};
    const list = [];
    for (const p of all[roomId] ?? []) {
      const m = await this.store.getMessage(p.target);
      if (m && p.until > now && m.expiresAt > now && !this.hidden.has(p.target) && !this.tombs.has(p.target)) list.push({ ...p, message: m });
    }
    return list;
  }
  async applyPin(inner) {
    const { target, until } = inner.body;
    const orig = await this.store.getMessage(target);
    if (!orig || orig.room !== inner.room) return;
    const all = (await this.store.get('pins')) ?? {};
    let list = (all[inner.room] ?? []).filter((p) => p.target !== target);
    // Nunca passa do prazo da própria mensagem.
    if (until > 0) list = [...list, { target, until: Math.min(until, orig.expiresAt), by: inner.sender, at: Date.now() }].slice(-3);
    all[inner.room] = list;
    await this.store.put('pins', all);
  }
  // Favoritas: só neste aparelho, e vencem junto com a mensagem (passo 9).
  async star(msgId, on) {
    const m = await this.store.getMessage(msgId);
    if (m) await this.store.putMessage({ ...m, starred: !!on });
  }
  react(roomId, target, emoji) { return this.sendInner(roomId, 'reaction', { target, emoji }); }

  async edit(roomId, target, text) {
    const orig = await this.store.getMessage(target);
    if (!orig || orig.sender !== this.userId) throw new Error('só o autor edita');
    if (orig.room !== roomId || orig.kind !== 'text') throw new Error('edição de outra conversa');
    if ((this.api.clock.now() ?? Date.now()) - orig.acceptedAt > EDIT_WINDOW_MS) throw new Error('só dá para editar nos primeiros 15 minutos');
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

  async deleteForAll(roomId, msgId, { mediaId = null } = {}) {
    await this.api.post(`/v1/rooms/${roomId}/messages/${msgId}/delete`);
    // O servidor já revoga a mídia ligada à mensagem (F04). Mensagens de antes
    // dessa ligação: revoga aqui; "já não existe" é o resultado esperado.
    if (mediaId) await this.api.post(`/v1/media/${mediaId}/revoke`).catch((e) => { if (![404, 410].includes(e.status)) throw e; });
    this.tombs.set(msgId, Date.now());
    await this.saveMarks();
    await this.destroy([msgId]);
  }

  async deleteForMe(msgId) { return this.deleteManyForMe([msgId]); }

  // Apagar conversa (V7-007): tudo desta conversa some só deste aparelho;
  // os outros continuam vendo até o prazo.
  async deleteManyForMe(ids) {
    if (!ids.length) return;
    const now = Date.now();
    for (const id of ids) this.hidden.set(id, now);
    await this.saveMarks();
    await this.destroy(ids);
  }
  async clearRoomForMe(roomId) {
    for (const o of await this.outbox()) if (o.roomId === roomId) await this.cancelQueued(o.payload.msgId);
    const ids = (await this.store.roomMessages(roomId)).map((m) => m.msgId);
    await this.deleteManyForMe(ids);
    return ids.length;
  }

  // ---------- mídia ----------
  // Pré-upload durável: só ciphertext e a CEK dentro do banco cifrado.
  // Um lote inteiro é preparado antes de iniciar qualquer pedido de rede.
  prepareMedia(roomId, bytes, opts = {}) { return this.stateWork(() => this._prepareMedia(roomId, bytes, opts)); }
  prepareMediaBatch(roomId, items) { return this.stateWork(async () => {
    if (!Array.isArray(items) || items.length < 1 || items.length > 5) throw new Error('Selecione de 1 a 5 fotos.');
    const ids = [];
    try {
      for (const item of items) ids.push(await this._prepareMedia(roomId, item.bytes, item.opts));
      return ids;
    } catch (e) { e.preparedIds = ids; throw e; }
  }); }
  async _prepareMedia(roomId, bytes, { mode = 'media', mime = 'application/octet-stream', caption, duration, name, round, hd } = {}) {
    const msgId = newMsgId(), mediaId = newMsgId();
    const key = await newMediaKey();
    let blob;
    try {
      blob = await encryptMedia(key, bytes, { pad: mode !== 'doc' });
      const body = { mediaId, key: b64(key), mime, mode, size: bytes.byteLength, ...(caption ? { caption } : {}), ...(duration ? { duration: Math.round(duration) } : {}), ...(name ? { name } : {}), ...(round ? { round: true } : {}), ...(hd ? { hd: true } : {}) };
      const chunks = Math.ceil(blob.length / (192 * 1024));
      await this.queue(roomId, { msgId, mediaId }, { msgId, room: roomId, sender: this.userId, kind: 'media', body: mode === 'once' ? { ...body, key: null } : body, mine: true });
      await this.updateQueued(msgId, { state: 'staging', prepared: { body, chunks, size: blob.length } });
      for (let i = 0; i < chunks; i++) await this.store.put(`upload:${msgId}:${i}`, b64(blob.subarray(i * 192 * 1024, (i + 1) * 192 * 1024)));
      await this.updateQueued(msgId, { state: 'prepared' });
      return msgId;
    } finally { key.fill(0); blob?.fill(0); }
  }
  async sendMedia(roomId, bytes, opts) {
    const id = await this.prepareMedia(roomId, bytes, opts);
    return this.deliver(roomId, id);
  }
  async uploadPrepared(item) {
    const { body, chunks, size } = item.prepared;
    // API antiga ignora uploadId e criaria um objeto novo em cada retry.
    // Recusa antes de transmitir bytes em vez de depender desse comportamento.
    let capabilities;
    try { capabilities = await this.api.get('/v1/capabilities'); }
    catch (e) { if (e.status !== 404) throw e; }
    if (capabilities?.mediaUploadIds !== 1) throw Object.assign(new Error('A API precisa ser atualizada antes de enviar mídias nesta versão.'), { status: 409, code: 'api_update_required' });
    await this._checkSecurityEvents();
    const view = await this.room(item.roomId);
    const to = view.members.filter((m) => m.active && m.userId !== this.userId).map((m) => m.userId);
    this.checkRecipients(item.roomId, view, to);
    this.assertMediaAllowed(to);
    const blob = new Uint8Array(size);
    try {
      for (let i = 0; i < chunks; i++) {
        const saved = await this.store.get(`upload:${item.payload.msgId}:${i}`);
        if (!saved) throw Object.assign(new Error('preparação incompleta: remova e selecione o arquivo novamente'), { status: 400, code: 'incomplete_upload' });
        const part = unb64(saved);
        blob.set(part, i * 192 * 1024); part.fill(0);
      }
      await this.api.post(`/v1/rooms/${item.roomId}/media?mode=${body.mode}&uploadId=${body.mediaId}`, blob);
    } finally { blob.fill(0); }
    return this._sendInner(item.roomId, 'media', body, { msgKind: 'media', mediaId: body.mediaId, localBody: body.mode === 'once' ? { ...body, key: null } : null, queueId: item.payload.msgId });
  }
  async eraseUpload(item) {
    for (let i = 0; i < (item.prepared?.chunks ?? 0); i++) await this.store.put(`upload:${item.payload.msgId}:${i}`, null);
    if (item.prepared) await this.onDestroy([]);
  }
  async cleanupUpload(item) {
    if (!item.prepared) return;
    try { await this.api.post(`/v1/media/${item.prepared.body.mediaId}/revoke`); }
    catch (e) { if (![404, 410].includes(e.status)) throw e; }
  }
  retryQueued(msgId) { return this.stateWork(async () => {
    const item = (await this.outbox()).find((o) => o.payload.msgId === msgId);
    if (!item || ['staging', 'cancelled'].includes(item.state)) throw new Error('envio incompleto ou cancelado: remova e selecione novamente');
    if (item.prepared) {
      await this.cleanupUpload(item);
      await this.updateQueued(msgId, { payload: { msgId, mediaId: item.prepared.body.mediaId }, cleanupPending: false });
    }
    await this.updateQueued(msgId, { state: item.prepared ? 'prepared' : 'ready', nextTryAt: 0 });
    return this._deliver(item.roomId, msgId);
  }); }
  cancelQueued(msgId) { return this.stateWork(() => this._cancelQueued(msgId)); }
  async _cancelQueued(msgId) {
    const item = (await this.outbox()).find((o) => o.payload.msgId === msgId);
    if (!item) return;
    // Mantém somente a intenção de limpeza, sem CEK nem conteúdo local.
    await this.updateQueued(msgId, { state: 'cancelled', local: null, ...(item.prepared ? { prepared: { body: { mediaId: item.prepared.body.mediaId }, chunks: item.prepared.chunks } } : {}) });
    await this.eraseUpload(item);
    if (item.prepared) {
      const cleanup = { body: { mediaId: item.prepared.body.mediaId }, chunks: 0 };
      await this.updateQueued(msgId, { prepared: cleanup });
    }
    try { await this.cleanupUpload(item); await this.dequeue(msgId); } catch { /* sync repete */ }
  }

  // Story (§22): foto ou vídeo para quem a pessoa escolher, com prazo
  // próprio (24 h por padrão). Ninguém fica sabendo quem viu.
  async sendStory(bytes, { mime, audience, ttl, caption, duration } = {}) {
    // Confere a audiência antes de subir qualquer coisa.
    const view = await this.room(CIRCLE_ROOM_ID);
    const circle = view.members.filter((m) => m.active && m.userId !== this.userId).map((m) => m.userId);
    if (!audience?.length || audience.some((u) => !circle.includes(u))) throw new Error('audiência inválida');
    const roster = this.circleRoster();
    if (!roster || !roster.includes(this.userId) || audience.some((u) => !roster.includes(u))) throw new Error('audiência inválida: alguém não foi confirmado pela administradora');
    this.assertMediaAllowed(audience);
    const key = await newMediaKey();
    const blob = await encryptMedia(key, bytes, { pad: true });
    const q = new URLSearchParams({ mode: 'media', story: '1', audience: audience.join(','), ...(ttl ? { ttl: String(ttl) } : {}) });
    const up = await this.api.post(`/v1/rooms/${CIRCLE_ROOM_ID}/media?${q}`, blob);
    const body = { mediaId: up.mediaId, key: b64(key), mime, ...(caption ? { caption } : {}), ...(duration ? { duration: Math.round(duration) } : {}) };
    key.fill(0);
    return this.sendInner(CIRCLE_ROOM_ID, 'story', body, { msgKind: 'story', audience, ttl, view, mediaId: up.mediaId });
  }
  async stories() {
    const r = await this.view(CIRCLE_ROOM_ID);
    return r.render.filter((m) => m.kind === 'story');
  }

  async openMedia(msg, { signal } = {}) {
    signal?.throwIfAborted();
    if (!msg.body?.key) throw new Error('mídia sem chave neste aparelho (já vista ou enviada por você)');
    const once = msg.body.mode === 'once';
    const key = unb64(msg.body.key);
    let bytes;
    try {
      if (once) {
        // Uma tentativa tem resultado incerto se a rede cair. Esqueça a chave
        // persistida ANTES da requisição, inclusive se houver bloqueio no meio.
        const stored = await this.store.getMessage(msg.msgId);
        if (!stored?.body?.key || stored.consumed) throw new Error('mídia já aberta ou em abertura');
        await this.store.putMessage({ ...stored, body: { ...stored.body, key: null }, consumed: true });
        await this.onDestroy([]);
      }
      signal?.throwIfAborted();
      const blob = await this.api.post(`/v1/media/${msg.body.mediaId}/open`, undefined, { binary: true, signal });
      signal?.throwIfAborted();
      bytes = await decryptMedia(key, blob);
      signal?.throwIfAborted();
      return bytes;
    } catch (e) { bytes?.fill(0); throw e; }
    finally { key.fill(0); }
  }

  // ---------- foto de perfil / foto e fundo de grupo (§21) ----------
  // Cifra no aparelho; o servidor guarda só a versão atual. Devolve a
  // referência {mediaId, key} que vai cifrada no anúncio (nunca ao servidor).
  async setVisual(scope, ownerId, slot, bytes) {
    const key = await newMediaKey();
    try {
      const blob = await encryptMedia(key, bytes);
      const r = await this.api.post(`/v1/visual/${scope}/${ownerId}/${slot}`, blob);
      return { mediaId: r.mediaId, key: b64(key) };
    } finally { key.fill(0); }
  }
  removeVisual(scope, ownerId, slot) { return this.api.post(`/v1/visual/${scope}/${ownerId}/${slot}?remove=1`); }
  async openVisual(ref) {
    const blob = await this.api.get(`/v1/visual/${ref.mediaId}`, { binary: true });
    const key = unb64(ref.key);
    try { return await decryptMedia(key, blob); } finally { key.fill(0); }
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

  // Eventos de segurança do círculo (troca de aparelho, recuperação, entrada,
  // remoção): qualquer um deles faz reler o diretório antes de cifrar de novo,
  // para não mandar nada para uma chave que não vale mais.
  checkSecurityEvents() { return this.stateWork(() => this._checkSecurityEvents()); }
  async _checkSecurityEvents() {
    const after = (await this.store.get('secSeq')) ?? 0;
    const { events } = await this.api.get(`/v1/security-events?after=${after}`);
    if (!events.length) return [];
    // Linha do tempo de segurança (S1/S3): entrou, saiu, trocou de aparelho.
    // (aparelho novo começa do zero: o histórico antigo não vira aviso)
    if (after > 0) for (const e of events) if (['joined', 'removed', 'device_changed', 'recovered'].includes(e.kind) && e.userId) this.warn({ kind: `circle_${e.kind}`, userId: e.userId, at: e.at });
    if (events.some((e) => ['device_changed', 'recovered', 'joined', 'removed', 'frozen', 'unfrozen'].includes(e.kind))) await this._refreshDirectory();
    else await this.saveWarnings();
    await this.store.put('secSeq', events.at(-1).seq);
    return events;
  }

  sync() { return this.stateWork(() => this._sync()); }
  async _sync() {
    // Juntos: avisos de segurança e caixa de entrada. Os avisos são
    // aplicados (diretório relido) antes de decifrar qualquer envelope.
    const [security, res] = await Promise.all([this._checkSecurityEvents(), this.api.get('/v1/sync')]);
    // F10: com a rede de volta, o que ficou na fila vai (mesmo id, sem duplicar).
    const retried = await this._retryOutbox().catch(() => ({ sent: [], failed: [] }));
    const acks = { envelopes: [], tombstones: [] };
    // 1) tombstones primeiro: nada apagado chega a aparecer (§12).
    for (const t of res.tombstones) {
      this.tombs.set(t.msgId, Date.now());
      acks.tombstones.push([t.room, t.msgId]);
    }
    await this.destroy(res.tombstones.map((t) => t.msgId));
    const received = [], rejected = [];
    for (let e of res.envelopes) {
      acks.envelopes.push([e.room, e.msgId]);
      if (this.tombs.has(e.msgId)) continue;
      if (!this.known[e.sender]) await this._refreshDirectory();
      try {
        const { type, body } = parseOuter(e.ct);
        const inner = decodeInner(await this.decryptFrom(e.sender, type, body));
        // Anti-falsificação: o que está dentro tem que bater com o que o
        // servidor autenticou (remetente, conversa e id).
        if (inner.sender !== e.sender || inner.room !== e.room || inner.msgId !== e.msgId) throw new Error('remetente ou conversa não conferem');
        if (inner.room === CIRCLE_ROOM_ID && ['nickname_change', 'story'].includes(inner.kind)) {
          const admin = await this.circleAdminId(), roster = this.circleRoster();
          const intake = inner.kind === 'nickname_change' && this.userId === admin;
          if (!intake && (!roster || !roster.includes(inner.sender) || !roster.includes(this.userId))) throw new Error('remetente do círculo não confirmado');
        }
        // O prazo nunca passa do que quem enviou pediu, nem de 15 dias a
        // partir de agora, mesmo que o servidor diga outra coisa.
        const now = this.api.clock.now() ?? e.acceptedAt;
        const limit = Math.min(inner.ttl ? e.acceptedAt + inner.ttl * 1000 : Infinity, now + MAX_TTL * 1000);
        if (e.expiresAt > limit) {
          this.warn({ kind: 'ttl_clamped', roomId: e.room, at: now });
          e = { ...e, expiresAt: limit };
        }
        await this.apply(inner, e);
        received.push(inner);
      } catch (err) {
        rejected.push({ msgId: e.msgId, sender: e.sender, reason: String(err.message || err) });
        // Falha de decifra ou de autenticação nunca passa em silêncio.
        this.warn({ kind: 'message_rejected', userId: e.sender, roomId: e.room, at: this.api.clock.now() });
      }
    }
    await this.persistCrypto(); // estado salvo antes de confirmar
    await this.saveMarks();
    await this.saveWarnings();
    if (acks.envelopes.length || acks.tombstones.length) await this.api.post('/v1/ack', acks);
    return { received, rejected, tombstones: res.tombstones.length, more: res.more, security, retried };
  }

  async apply(inner, e) {
    const base = { msgId: inner.msgId, room: inner.room, sender: inner.sender, acceptedAt: e.acceptedAt, expiresAt: e.expiresAt, replyTo: inner.replyTo };
    switch (inner.kind) {
      case 'text': return this.store.putMessage({ ...base, kind: 'text', text: inner.body.text });
      case 'media': return this.store.putMessage({ ...base, kind: 'media', body: inner.body });
      case 'story': return inner.room === CIRCLE_ROOM_ID ? this.store.putMessage({ ...base, kind: 'story', body: inner.body }) : undefined;
      case 'edit': {
        // F09: mesma conversa, mesmo autor (applyEdit), só texto e dentro do
        // prazo de edição (D7). Fora disso é ignorada.
        const orig = await this.store.getMessage(inner.body.target);
        if (!orig || orig.room !== inner.room || orig.kind !== 'text') return;
        if (e.acceptedAt - orig.acceptedAt > EDIT_WINDOW_MS + EDIT_GRACE_MS) return;
        await this.store.putMessage(applyEdit(orig, inner));
        return;
      }
      case 'membership': return this.applyMembership(inner);
      case 'poll': return this.store.putMessage({ ...base, kind: 'poll', body: inner.body, votes: {} });
      case 'vote': {
        // Voto só de membro confirmado, na mesma conversa, com opções válidas.
        const orig = await this.store.getMessage(inner.body.target);
        if (!orig || orig.kind !== 'poll' || orig.room !== inner.room) return;
        if (!this.trusted[inner.room]?.members.includes(inner.sender)) return;
        const choices = [...new Set(inner.body.choices)].filter((c) => c < orig.body.options.length);
        if (!orig.body.multi && choices.length > 1) return;
        return this.store.putMessage({ ...orig, votes: { ...(orig.votes ?? {}), [inner.sender]: choices } });
      }
      case 'pin': {
        if (!this.trusted[inner.room]?.members.includes(inner.sender)) return;
        return this.applyPin(inner);
      }
      case 'reaction': {
        // F09: só na mesma conversa, só de quem é membro confirmado, nunca em
        // ver uma vez.
        const orig = await this.store.getMessage(inner.body.target);
        if (!orig || orig.room !== inner.room || orig.body?.mode === 'once') return;
        if (inner.room !== CIRCLE_ROOM_ID && !this.trusted[inner.room]?.members.includes(inner.sender)) return;
        if (orig) await this.store.putMessage({ ...orig, reactions: { ...(orig.reactions ?? {}), [inner.sender]: inner.body.emoji } });
        return;
      }
      default: return; // outros tipos são tratados pela interface (política etc.)
    }
  }

  // Aceita o anúncio só da líder confirmada; na primeira vez, de quem criou e
  // se declara líder; se a líder confirmada saiu, do sucessor na ordem
  // confirmada (membro mais antigo, V6-023).
  async applyMembership(inner) {
    const { members, leader } = inner.body;
    if (inner.room === CIRCLE_ROOM_ID) {
      // Lista do círculo: só da administradora fixada (S3).
      let admin = await this.circleAdminId();
      // Diretório antigo (sem ordem de entrada): relê antes de decidir.
      if (!admin) { await this._refreshDirectory(); admin = await this.circleAdminId(); }
      const current = this.trusted[CIRCLE_ROOM_ID];
      const revision = inner.body.revision ?? 0;
      if (!admin || inner.sender !== admin || leader !== admin || this.known[admin]?.curve !== this.circleAdminKey
        || (current?.revision > 0 && revision <= current.revision)) { this.warn({ kind: 'membership_rejected', roomId: inner.room, from: inner.sender, at: this.api.clock.now() }); return; }
      this.trusted[CIRCLE_ROOM_ID] = { members, leader, revision, adminCurve: this.circleAdminKey };
      this.circleRosterChanged = true;
      await this.store.put('trusted', this.trusted);
      return;
    }
    if (!members.includes(this.userId)) {
      delete this.trusted[inner.room]; // fui removida: nada mais a enviar aqui
    } else {
      const t = this.trusted[inner.room];
      let ok;
      if (!t) ok = inner.sender === leader;
      else if (inner.sender === t.leader) ok = true;
      else {
        const successor = t.members.find((u) => u !== t.leader && members.includes(u));
        ok = !members.includes(t.leader) && inner.sender === successor;
      }
      if (!ok) { this.warn({ kind: 'membership_rejected', roomId: inner.room, from: inner.sender, at: this.api.clock.now() }); return; }
      this.trusted[inner.room] = { members, leader };
    }
    await this.store.put('trusted', this.trusted);
  }

  // O que pode aparecer agora, depois de aplicar tudo (§25.6).
  async view(roomId) {
    const messages = await this.store.roomMessages(roomId);
    const r = reconcile({ messages, tombstones: this.tombs, hiddenForMe: this.hidden, trustedNow: this.api.clock.now() });
    await this.destroy(r.destroy);
    return r;
  }
}
