// Sessão do app: liga cofre, banco cifrado, núcleo do cliente e servidor.
// Tudo que é segredo só existe aqui enquanto o app está desbloqueado.
import { CONFIG } from './config.js';
import { loadCrypto } from './packages/crypto/index.js';
import { TrustedClock } from './packages/protocol/src/time.js';
import { CIRCLE_ROOM_ID } from './packages/protocol/src/room.js';
import { normalize, searchByPrefix, validNickname } from './packages/protocol/src/nickname.js';
import { MessengerClient } from './packages/client/src/client.js';
import { Api } from './packages/client/src/api.js';
import { EncryptedStore } from './db/store.js';
import { idbGet, idbPut, idbClear, idbPutMany } from './idb.js';
import * as vault from './vault/vault.js';
import * as passkey from './vault/passkey.js';
import * as native from './vault/native.js';

const REANNOUNCE_MS = 7 * 86_400_000;
const listeners = new Set();
export const S = { client: null, store: null, clock: null, kek: null, nicknames: {}, rooms: {}, unlocked: false };

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = (what) => { for (const fn of listeners) { try { fn(what); } catch (e) { console.error(e); } } };

let cryptoReady;
export const ensureCrypto = () => (cryptoReady ??= loadCrypto());

export const vaultStore = { load: () => idbGet('vault'), save: (r) => idbPut('vault', r) };
export const hasVault = async () => !!(await idbGet('vault'));

function makeClient(pickleKey) {
  S.clock = new TrustedClock();
  return new MessengerClient({ api: new Api(CONFIG.api, S.clock), store: S.store, pickleKey, onDestroy: () => scheduleRotate() });
}

// ---------- os dados morrem (ADR 0012) ----------
// Depois de qualquer exclusão, o banco inteiro é copiado (só o que ainda vale)
// para um arquivo novo com DEK nova; o cofre passa a apontar para ele numa
// gravação atômica; o arquivo antigo é removido. Restos do banco velho ficam
// cifrados com uma DEK que não existe mais em lugar nenhum.
const ROTATE_DELAY = 15_000;
const ROTATE_EVERY = 24 * 3_600_000;
let rotateTimer = null, rotating = null, dirty = false;
const newPoolName = () => 'p' + vault.b64(vault.random(9)).replace(/[+/=]/g, '').slice(0, 10);

export function scheduleRotate() {
  dirty = true;
  clearTimeout(rotateTimer);
  rotateTimer = setTimeout(() => rotate().catch((e) => console.error('rotação falhou', e?.message)), ROTATE_DELAY);
}

export function rotate() {
  if (!S.unlocked) return Promise.resolve(false);
  if (!S.kek) return Promise.reject(new Error('sem chave de embrulho em memória: rotação impossível'));
  return (rotating ??= (async () => {
    try {
      clearTimeout(rotateTimer);
      dirty = false;
      const rec = await vaultStore.load();
      const { record, dek } = await vault.rotateDek(rec, S.kek);
      const name = newPoolName();
      await S.store.rebuild(dek, name, S.clock?.now() ?? Date.now());
      await idbPutMany({ vault: record, activePool: name, lastRotate: Date.now() }); // troca atômica
      await S.store.switchTo(name);
      emit('rotated');
      return true;
    } catch (e) { dirty = true; throw e; } finally { rotating = null; }
  })());
}

// ---------- criar cofre + identidade ----------
export async function createLock({ mode, secret }) {
  await ensureCrypto();
  let prf = null, credentialId = null, prfSalt = null;
  if (mode === 'passkey' && native.isNative()) {
    // Android: segredo do Keystore liberado pela biometria.
    prf = await native.nativeSecret();
    credentialId = native.NATIVE_ID;
  } else if (mode === 'passkey') {
    const salt = vault.random(32);
    const reg = await passkey.register(salt);
    credentialId = reg.credentialId;
    prf = reg.prf ?? await passkey.evaluate(credentialId, salt);
    prfSalt = vault.b64(salt);
  }
  const { record, dek, kek } = await vault.createVault({ mode, prf, secret, credentialId, prfSalt });
  prf?.fill(0);
  return { record, dek, kek };
}

async function openStore(dek, { fresh = false } = {}) {
  S.store ??= new EncryptedStore();
  const name = fresh ? newPoolName() : (await idbGet('activePool')) ?? 'a';
  await S.store.open(name);
  await S.store.cleanup(name); // restos de uma rotação interrompida
  await S.store.unlock(dek);
  return name;
}

// Primeira vez: cofre novo, identidade nova (convite ou instalação).
export async function enroll({ lock, how, token, setupCode }) {
  const pool = await openStore(lock.dek, { fresh: true });
  S.kek = lock.kek;
  const pickleKey = vault.random(32);
  await S.store.put('pickleKey', vault.b64(pickleKey));
  S.client = makeClient(pickleKey);
  const r = how === 'bootstrap' ? await S.client.bootstrap(setupCode) : await S.client.redeem(token);
  await idbPutMany({ vault: lock.record, activePool: pool, lastRotate: Date.now() }); // só grava o cofre quando a identidade existe
  await afterUnlock();
  return r;
}

// Troca de aparelho (V7-015): o aparelho novo mostra código; o antigo aprova.
export async function pairStart(lock) {
  lock.pool = await openStore(lock.dek, { fresh: true });
  S.kek = lock.kek;
  const pickleKey = vault.random(32);
  await S.store.put('pickleKey', vault.b64(pickleKey));
  S.client = makeClient(pickleKey);
  const device = await S.client.createDevice();
  const start = await S.client.api.post('/v1/devices/pair/start', { device });
  const fp = await fingerprint(device.curve);
  return { start, device, fp, lock };
}
export async function pairPoll({ start, device, lock }) {
  const st = await S.client.api.post('/v1/devices/pair/status', { pairingId: start.pairingId, authPub: device.authPub });
  if (st.state !== 'approved') return st.state;
  Object.assign(S.client, { userId: st.userId, deviceId: st.deviceId });
  await S.client.saveDevice();
  await idbPutMany({ vault: lock.record, activePool: lock.pool, lastRotate: Date.now() });
  await afterUnlock();
  return 'approved';
}

// ---------- desbloquear ----------
export async function unlock(secret) {
  await ensureCrypto();
  const rec = await vaultStore.load();
  let prf = null;
  if (rec?.mode === 'passkey') prf = rec.credentialId === native.NATIVE_ID ? await native.nativeSecret() : await passkey.evaluate(rec.credentialId, vault.unb64(rec.prfSalt));
  const { dek, kek } = await vault.openVault(vaultStore, { prf, secret });
  prf?.fill(0);
  await openStore(dek);
  S.kek = kek;
  const pickleKey = vault.unb64(await S.store.get('pickleKey'));
  S.client = makeClient(pickleKey);
  await S.client.open();
  await afterUnlock();
}

async function afterUnlock() {
  await S.client.login();
  S.unlocked = true;
  if (Date.now() - ((await idbGet('lastRotate')) ?? 0) > ROTATE_EVERY) scheduleRotate();
  S.nicknames = (await S.store.get('nicknames')) ?? {};
  S.rooms = (await S.store.get('rooms')) ?? {};
  await S.client.refreshDirectory();
  await syncNow();
  connectLive();
  emit('unlocked');
}

// Sair do app esconde na hora e, depois de um tempo, tranca de verdade (§20).
export async function lock(reason = 'manual') {
  if (!S.unlocked) return;
  // Algo foi apagado e a rotação ainda não rodou: roda antes de trancar.
  if (dirty && reason !== 'wipe') await rotate().catch((e) => console.error('rotação falhou', e?.message));
  S.unlocked = false;
  S.kek = null;
  clearTimeout(rotateTimer);
  // Nada legível fica na memória da página depois de trancar.
  S.nicknames = {};
  S.rooms = {};
  viewCache.clear();
  disconnectLive();
  S.client = null;
  await S.store?.lock();
  emit({ locked: reason });
}

export async function wipeEverything() {
  // Antes de destruir as chaves: cancela notificações e encerra a sessão no servidor.
  if (S.unlocked) {
    try { await S.client.api.post('/v1/push', { endpoint: null }); } catch {}
    try { await S.client.api.post('/v1/auth/logout'); } catch {}
    try { const reg = await navigator.serviceWorker?.ready; await (await reg?.pushManager?.getSubscription())?.unsubscribe(); } catch {}
  }
  await lock('wipe');
  await S.store?.wipe();
  await native.nativeDestroy();
  await idbClear();
  try { indexedDB.deleteDatabase('mp-app'); } catch {}
}

// ---------- sincronização ----------
// Um pedido que chega durante uma sincronização em curso (ex.: aviso do
// WebSocket) não pode se perder: marca `again` e o laço roda mais uma vez.
let syncing = null, again = false;
export function syncNow() {
  if (!S.unlocked) return Promise.resolve();
  if (syncing) { again = true; return syncing; }
  return (syncing = (async () => {
    try {
      do {
        again = false;
        let more = true, rounds = 0;
        while (more && rounds++ < 10 && S.unlocked) {
          const r = await S.client.sync();
          for (const x of r.rejected) console.warn('mensagem recusada', x.msgId, x.sender, x.reason);
          await handleExtras(r.received);
          more = r.more;
        }
        if (!S.unlocked) break;
        if (S.clock.now() && (await S.store.purgeExpired(S.clock.now())) > 0) scheduleRotate();
        await maybeAnnounce();
        emit('synced');
      } while (again && S.unlocked);
    } finally { syncing = null; again = false; }
  })());
}

async function handleExtras(received) {
  let changed = false;
  for (const m of received) {
    if (m.kind === 'nickname_change' && m.room === CIRCLE_ROOM_ID && !validNickname(m.body.nickname)) {
      S.nicknames[m.sender] = { nickname: m.body.nickname.trim(), at: Date.now() };
      changed = true;
    }
    if (m.kind === 'room_profile') {
      // Nome do grupo só da líder confirmada de ponta a ponta (não do servidor).
      if (S.client.trusted[m.room]?.leader === m.sender) { S.rooms[m.room] = { ...(S.rooms[m.room] ?? {}), title: m.body.title }; changed = true; }
    }
    if (m.room !== CIRCLE_ROOM_ID && !S.rooms[m.room]) { S.rooms[m.room] = {}; changed = true; }
  }
  if (changed) { await S.store.put('nicknames', S.nicknames); await S.store.put('rooms', S.rooms); }
}

// ---------- apelidos ----------
export const myNickname = () => S.nicknames[S.client?.userId]?.nickname ?? null;
export const nameOf = (userId) => S.nicknames[userId]?.nickname ?? 'Alguém';

export async function setNickname(nick) {
  const problem = validNickname(nick);
  if (problem) throw new Error(problem);
  const taken = Object.entries(S.nicknames).some(([u, n]) => u !== S.client.userId && normalize(n.nickname) === normalize(nick));
  if (taken) throw new Error('Esse apelido já existe no círculo.');
  S.nicknames[S.client.userId] = { nickname: nick.trim(), at: Date.now() };
  await S.store.put('nicknames', S.nicknames);
  await announce();
}

async function announce() {
  const nick = myNickname();
  if (!nick) return;
  const view = await roomView(CIRCLE_ROOM_ID, true);
  if (view && view.members.filter((m) => m.active).length > 1) await S.client.sendInner(CIRCLE_ROOM_ID, 'nickname_change', { nickname: nick });
  await S.store.put('lastAnnounce', { at: Date.now(), members: view?.members.filter((m) => m.active).length ?? 0 });
}

// Reanuncia quando entra alguém novo ou a cada 7 dias (o prazo máximo é 15).
async function maybeAnnounce() {
  if (!myNickname()) return;
  const last = (await S.store.get('lastAnnounce')) ?? { at: 0, members: 0 };
  const view = await roomView(CIRCLE_ROOM_ID, true);
  const n = view?.members.filter((m) => m.active).length ?? 0;
  if (n > last.members || Date.now() - last.at > REANNOUNCE_MS) await announce();
}

export function searchPeople(term) {
  const dir = Object.entries(S.nicknames).map(([userId, n]) => ({ userId, nickname: n.nickname }));
  return searchByPrefix(dir, term, { self: S.client.userId });
}

// ---------- conversas ----------
const viewCache = new Map();
export async function roomView(roomId, fresh = false) {
  if (!fresh && viewCache.has(roomId)) return viewCache.get(roomId);
  try { const v = await S.client.room(roomId); viewCache.set(roomId, v); return v; } catch { return null; }
}

export function roomTitle(view) {
  if (!view) return 'Conversa';
  if (view.kind === 'direct') return nameOf(view.members.find((m) => m.userId !== S.client.userId)?.userId);
  return S.rooms[view.roomId]?.title || 'Grupo';
}

export async function listRooms() {
  const res = await S.client.api.get('/v1/rooms');
  const ids = res.rooms.filter((r) => r !== CIRCLE_ROOM_ID);
  for (const id of ids) if (!S.rooms[id]) S.rooms[id] = {};
  return Promise.all(ids.map((id) => roomView(id)));
}

export async function startDirect(userId) {
  const v = await S.client.createRoom('direct', [userId]);
  S.rooms[v.roomId] = {};
  await S.store.put('rooms', S.rooms);
  viewCache.set(v.roomId, v);
  return v;
}

export async function startGroup(title, members, ttls) {
  const v = await S.client.createRoom('group', members, ttls);
  S.rooms[v.roomId] = { title };
  await S.store.put('rooms', S.rooms);
  viewCache.set(v.roomId, v);
  await S.client.sendInner(v.roomId, 'room_profile', { title });
  return v;
}

export async function setRoomTitle(roomId, title) {
  await S.client.sendInner(roomId, 'room_profile', { title });
  S.rooms[roomId] = { ...(S.rooms[roomId] ?? {}), title };
  await S.store.put('rooms', S.rooms);
}

export async function roomEvent(roomId, ev) {
  const v = await S.client.roomEvent(roomId, ev);
  viewCache.set(roomId, v);
  return v;
}

// ---------- segurança ----------
export async function fingerprint(curveB64) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', vault.unb64(curveB64)));
  // 12 grupos de 5 dígitos, como o número de segurança do Signal.
  const out = [];
  for (let i = 0; i < 12; i++) out.push(String(((h[i * 2] << 8) | h[i * 2 + 1]) % 100000).padStart(5, '0'));
  return out.join(' ');
}
export const myFingerprint = () => fingerprint(S.client.account.curve25519Key);

// ---------- tempo real e push ----------
let ws = null, wsRetry = null, pollTimer = null;
function connectLive() {
  disconnectLive();
  const url = CONFIG.api.replace(/^http/, 'ws') + '/v1/live';
  try {
    ws = new WebSocket(url, ['mp-v1', S.client.api.token]);
    // Aviso que chegou antes de o WebSocket abrir se perderia: sincroniza
    // ao abrir (inclusive em cada reconexão).
    ws.onopen = () => syncNow().catch((e) => console.error('sincronização falhou', e?.message));
    ws.onmessage = () => syncNow().catch((e) => console.error('sincronização falhou', e?.message));
    ws.onclose = () => { if (S.unlocked) wsRetry = setTimeout(connectLive, 10_000); };
  } catch {}
  pollTimer = setInterval(() => { if (!document.hidden) syncNow().catch((e) => console.error('sincronização falhou', e?.message)); }, 30_000);
}
function disconnectLive() {
  clearTimeout(wsRetry); clearInterval(pollTimer);
  if (ws) { ws.onclose = null; try { ws.close(); } catch {} ws = null; }
}

export async function enablePush() {
  const reg = await navigator.serviceWorker?.ready;
  if (!reg?.pushManager) throw new Error('Este aparelho não oferece notificações aqui. No iPhone, só no app instalado na Tela de Início.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permissão de notificação negada.');
  const { key } = await S.client.api.get('/v1/push/key');
  if (!key) throw new Error('Servidor sem chave de notificação.');
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vault.unb64(key.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((key.length + 3) % 4)) });
  await S.client.api.post('/v1/push', { endpoint: sub.endpoint });
}
