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
import { idbGet, idbPut, idbPutMany, idbDestroy } from './idb.js';
import * as vault from './vault/vault.js';
import * as passkey from './vault/passkey.js';
import * as native from './vault/native.js';
import * as push from './push.js';
import { discardAttachment } from './attachment-picker.js';
import { setSensitiveSession } from './sensitive-scope.js';

const REANNOUNCE_MS = 7 * 86_400_000;
const listeners = new Set();
export const S = { client: null, store: null, clock: null, kek: null, nicknames: {}, rooms: {}, prefs: {}, unlocked: false, locking: false };

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = (what) => { for (const fn of listeners) { try { fn(what); } catch (e) { console.error(e); } } };

// Marcas de tempo do desbloqueio (E3): só nomes de etapa, nenhum dado.
const mark = (name) => { try { performance.mark(`mp:${name}`); } catch {} };
let cryptoReady;
export const ensureCrypto = () => (cryptoReady ??= loadCrypto());

export const vaultStore = { load: () => idbGet('vault'), save: (r) => idbPut('vault', r) };
export const hasVault = async () => !!(await idbGet('vault'));
// Enquanto a pessoa digita o PIN: carrega a cripto e abre o arquivo do banco
// (ainda cifrado; a chave só vem depois do PIN). Nada legível é aberto aqui.
export async function prewarm() {
  try {
    await ensureCrypto();
    if (S.unlocked || S.locking) return;
    S.store ??= new EncryptedStore();
    await S.store.open((await idbGet('activePool')) ?? 'a');
  } catch {}
}

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
  // Guarde a referência ANTES do primeiro await: lock() pode zerar S.kek
  // enquanto a leitura do registro está em andamento.
  const kek = S.kek;
  if (!kek) return Promise.reject(new Error('sem chave de embrulho em memória: rotação impossível'));
  return (rotating ??= (async () => {
    try {
      clearTimeout(rotateTimer);
      dirty = false;
      const rec = await vaultStore.load();
      const { record, dek } = await vault.rotateDek(rec, kek);
      const name = newPoolName();
      await S.store.rebuild(dek, name, S.clock?.now() ?? Date.now());
      try {
        await idbPutMany({ vault: record, activePool: name, lastRotate: Date.now() }); // troca atômica
      } catch (e) {
        // O cofre ainda aponta para o banco anterior; solte a barreira nele.
        await S.store.abortRebuild();
        throw e;
      }
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
  try { return await vault.startVault({ mode, prf, secret, credentialId, prfSalt }); } finally { prf?.fill(0); }
}

// O servidor guarda a parte S do cofre (ADR 0014); só então a DEK é
// embrulhada e o cofre gravado. Exige a sessão já aberta.
export const DEFAULT_DEAD_DAYS = 15;
async function registerVault(lock) {
  const reg = await S.client.api.post('/v1/vault/register', { verifier: lock.verifier, deadDays: DEFAULT_DEAD_DAYS });
  const { record, kek } = await lock.finish(reg);
  S.kek = kek;
  return record;
}

// Pedido sem sessão (o app ainda está trancado). Erro de rede propaga.
async function vaultRelease(vaultId, verifier) {
  mark('release:start');
  const res = await fetch(`${CONFIG.api}/v1/vault/release`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vaultId, verifier }) });
  const body = await res.json().catch(() => ({}));
  if (res.ok && body.share) return { share: body.share, needsMigration: body.needsMigration === true };
  if (res.status === 404 && body.error === 'gone') return { gone: true };
  if (res.status === 403 && body.error === 'wrong_secret') return { wrong: true, left: body.left };
  throw new Error(`release ${res.status}`);
}

async function openStore(dek, { fresh = false } = {}) {
  S.store ??= new EncryptedStore();
  const name = fresh ? newPoolName() : (await idbGet('activePool')) ?? 'a';
  await S.store.open(name);
  await S.store.cleanup(name); // restos de uma rotação interrompida
  const r = await S.store.unlock(dek);
  // Veio do esquema antigo (metadados em claro): refaz o arquivo inteiro com
  // chave nova assim que der, para não sobrar página antiga no disco.
  if (r?.migrated) scheduleRotate();
  return name;
}

// Primeira vez: cofre novo, identidade nova (convite ou instalação).
// Instalação com o círculo já existente: `confirmRecover` pergunta à pessoa
// se é para recuperar a conta de administradora neste aparelho (R-01).
export async function enroll({ lock, how, token, setupCode, confirmRecover }) {
  const pool = await openStore(lock.dek, { fresh: true });
  const pickleKey = vault.random(32);
  await S.store.put('pickleKey', vault.b64(pickleKey));
  S.client = makeClient(pickleKey);
  let r;
  try {
    r = how === 'bootstrap' ? await S.client.bootstrap(setupCode) : await S.client.redeem(token);
  } catch (e) {
    if (how !== 'bootstrap' || e.code !== 'exists' || !(await confirmRecover?.())) {
      // N3: nada de banco aberto pela metade; uma nova tentativa começa limpa.
      // (Instalação nova: ainda não existe cofre nem banco de verdade.)
      S.client = null;
      await S.store?.wipe().catch(() => {});
      throw e;
    }
    return recoverAdmin(lock, pool, setupCode);
  }
  await S.client.login();
  const record = await registerVault(lock);
  await idbPutMany({ vault: record, activePool: pool, lastRotate: Date.now() }); // só grava o cofre quando a identidade existe
  await afterUnlock({ loggedIn: true });
  return r;
}

// Recuperação da administradora pelo código de instalação (R-01): mesma
// conta, aparelho e chaves novos; o cofre já vem registrado do servidor e
// tudo fica guardado antes de entrar.
async function recoverAdmin(lock, pool, setupCode) {
  const device = await S.client.createDevice();
  const r = await S.client.api.post('/v1/admin/recover', { setupCode, device, vault: { verifier: lock.verifier, deadDays: DEFAULT_DEAD_DAYS } });
  const { record, kek } = await lock.finish(r.vault);
  S.kek = kek;
  Object.assign(S.client, { userId: r.userId, deviceId: r.deviceId });
  await S.client.saveDevice();
  await idbPutMany({ vault: record, activePool: pool, lastRotate: Date.now() });
  await S.client.login();
  await afterUnlock({ loggedIn: true });
  return { userId: r.userId, deviceId: r.deviceId, recovered: true };
}

// Troca de aparelho (V7-015): o aparelho novo mostra código; o antigo aprova.
// Durável desde o começo: o cofre do aparelho novo é registrado já no pedido
// e tudo (chaves, pedido) fica guardado cifrado ANTES de mostrar o código. Se
// o app fechar em qualquer ponto, ao abrir com o PIN ele continua de onde
// parou. Isso importa porque um app antigo se apaga logo depois de aprovar.
export async function pairStart(lock, permit) {
  lock.pool = await openStore(lock.dek, { fresh: true });
  const pickleKey = vault.random(32);
  await S.store.put('pickleKey', vault.b64(pickleKey));
  S.client = makeClient(pickleKey);
  const device = await S.client.createDevice();
  const start = await S.client.api.post('/v1/devices/pair/start', { device, permit, vault: { verifier: lock.verifier, deadDays: DEFAULT_DEAD_DAYS } });
  if (!start.vault) throw new Error('servidor sem troca durável; atualize a API antes');
  const { record, kek } = await lock.finish(start.vault);
  S.kek = kek;
  const info = { pairingId: start.pairingId, code: start.code, expiresAt: start.expiresAt, authPub: device.authPub, fp: await fingerprint(device.curve) };
  await S.client.saveDevice();
  await S.store.put('pairing', info);
  await idbPutMany({ vault: record, activePool: lock.pool, lastRotate: Date.now(), pairPending: true });
  return info;
}
export async function pairPoll(info, beforeUnlock) {
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, S.client.authKey.privateKey, new TextEncoder().encode(`mp-pair-status-v1:${info.pairingId}`));
  const st = await S.client.api.post('/v1/devices/pair/status', { pairingId: info.pairingId, authPub: info.authPub, proof: vault.b64(new Uint8Array(signature)) });
  if (st.state === 'approved') await finishPairing(st, beforeUnlock);
  return st.state;
}
// Aprovado: entra (o servidor aceita o aparelho pendente só para isto) e
// confirma; só então o celular antigo cai. Confirmar de novo não quebra.
async function finishPairing(st, beforeUnlock) {
  Object.assign(S.client, { userId: st.userId, deviceId: st.deviceId });
  await S.client.saveDevice();
  await S.client.login();
  await S.client.api.post('/v1/devices/pair/commit');
  await S.store.put('pairing', null);
  await idbPut('pairPending', false);
  await beforeUnlock?.();
  await afterUnlock({ loggedIn: true });
}
// Pedido que venceu sem aprovação: este aparelho não tem nada de valor.
export class PairingExpiredError extends Error {
  constructor() { super('O pedido de troca venceu ou foi recusado. Comece de novo.'); }
}

// Celular antigo depois de aprovar: continua valendo até o novo confirmar.
// Quando a sessão cair (o novo confirmou), apaga tudo deste aparelho.
export function waitReplaced({ onReplaced, until = Date.now() + 60 * 60_000 } = {}) {
  const tick = async () => {
    if (!S.unlocked || Date.now() > until) return;
    try { await S.client.api.get('/v1/me'); }
    catch (e) {
      if (e.status === 401) { await wipeEverything(); onReplaced?.(); return; }
    }
    setTimeout(tick, 3000);
  };
  setTimeout(tick, 3000);
}

// ---------- desbloquear ----------
export async function unlock(secret) {
  mark('unlock:start');
  await ensureCrypto();
  mark('unlock:crypto');
  const rec = await vaultStore.load();
  let prf = null;
  if (rec?.mode === 'passkey') prf = rec.credentialId === native.NATIVE_ID ? await native.nativeSecret() : await passkey.evaluate(rec.credentialId, vault.unb64(rec.prfSalt));
  let opened;
  try { opened = await vault.openVault(vaultStore, { prf, secret, release: vaultRelease }); }
  catch (e) {
    // Parte do servidor destruída: nada aqui serve mais; apaga em silêncio
    // (no PIN de coação, quem olha vê só um app novo, sem aviso).
    if (e instanceof vault.VaultWipedError) await wipeEverything();
    throw e;
  } finally { prf?.fill(0); }
  mark('unlock:vault');
  const { dek, kek } = opened;
  try {
  await openStore(dek);
  mark('unlock:store');
  S.kek = kek;
  const pickleKey = vault.unb64(await S.store.get('pickleKey'));
  S.client = makeClient(pickleKey);
  await S.client.open();
  mark('unlock:client');
  // Troca de aparelho em andamento (app fechado no meio): continua.
  if (await idbGet('pairPending')) {
    const info = await S.store.get('pairing');
    const st = await pairPoll(info, async () => {
      if (opened.migrate) await migrateServerShare(opened);
      await completeVaultMigration().catch(() => {});
    });
    if (st === 'approved') return {};
    if (st === 'pending') return { pairing: info };
    await wipeEverything();
    throw new PairingExpiredError();
  }
  await S.client.login();
  mark('unlock:login');
  if (opened.upgrade) await upgradeVault(opened);
  if (opened.migrate) await migrateServerShare(opened);
  await completeVaultMigration().catch(() => {});
  await afterUnlock({ loggedIn: true });
  return {};
  } catch (e) {
    S.unlocked = false; setSensitiveSession(false);
    S.kek = null; S.client = null;
    await S.store?.lock().catch(() => {});
    throw e;
  } finally { opened.forget?.(); }
}

async function replaceVaultBank(record, dek, extra = {}) {
  const name = newPoolName();
  await S.store.rebuild(dek, name, S.clock?.now() ?? Date.now());
  try { await idbPutMany({ vault: record, activePool: name, lastRotate: Date.now(), ...extra }); }
  catch (e) { await S.store.abortRebuild(); throw e; }
  await S.store.switchTo(name);
}

async function migrateServerShare(opened) {
  const { record, dek, kek, previous } = await opened.migrate((vaultId) => S.client.api.post('/v1/vault/migrate/prepare', { vaultId }));
  await replaceVaultBank(record, dek, { shareMigration: { previous, vaultId: record.vaultId } });
  S.kek = kek;
}

async function completeVaultMigration() {
  const pending = await idbGet('shareMigration');
  if (!pending || !S.client) return;
  const result = await S.client.api.post('/v1/vault/migrate/commit', pending);
  if (!result.pending) await idbPut('shareMigration', null);
}

// Cofre antigo recebe parte S e DEK novas. Sem migração completa, a sessão
// não abre; o registro/banco anteriores permitem tentar no próximo desbloqueio.
async function upgradeVault(opened) {
  try {
    const { record, kek } = await opened.upgrade((b) => S.client.api.post('/v1/vault/register', { ...b, deadDays: DEFAULT_DEAD_DAYS }));
    const rotated = await vault.rotateDek(record, kek);
    await replaceVaultBank(rotated.record, rotated.dek);
    S.kek = kek;
  } catch (e) {
    opened.forget?.();
    console.error('migração do cofre adiada', e?.message);
    throw e;
  }
}

async function afterUnlock({ loggedIn = false } = {}) {
  announceCheck = true;
  if (!loggedIn) await S.client.login();
  S.unlocked = true;
  setSensitiveSession(true);
  if (Date.now() - ((await idbGet('lastRotate')) ?? 0) > ROTATE_EVERY) scheduleRotate();
  S.nicknames = (await S.store.get('nicknames')) ?? {};
  S.rooms = (await S.store.get('rooms')) ?? {};
  S.prefs = { ...DEFAULT_PREFS, ...((await S.store.get('prefs')) ?? {}) };
  // E3: a lista aparece já com o que está no aparelho; diretório e
  // sincronização seguem por trás (nessa ordem: o cliente serializa) e a tela
  // se atualiza com o aviso "synced". Enviar sempre confere as chaves antes.
  // Trancar no meio interrompe esse trabalho: não é erro (a próxima abertura
  // relê tudo; o que estava na memória já foi descartado).
  const client = S.client;
  const live = () => S.unlocked && !S.locking && S.client === client;
  const report = (what) => (e) => { if (live()) console.error(what, e?.message); };
  client.refreshDirectory().then(() => mark('unlock:directory'), report('diretório'))
    .then(() => (live() ? syncNow() : null))
    .then(() => mark('unlock:sync'), report('sincronização falhou'));
  connectLive();
  // Token novo ou permissão retirada nas configurações: acerta no servidor.
  // D15: o app não usa notificações. Quem tinha ligado é desligado aqui
  // (servidor esquece o destino e o aparelho apaga a assinatura).
  if (pushEnabled()) setPush(false).catch(() => {});
  else S.client.api.post('/v1/push', { endpoint: null }).catch(() => {});
  // S3: fixa quem é a administradora (primeira identidade do círculo).
  if (!S.client.circleAdmin) S.client.refreshDirectory().then(() => S.client?.circleAdminId()).catch(() => {});
  if (native.isNative()) await globalThis.Capacitor?.Plugins?.AttachmentPicker?.authorize();
  emit('unlocked');
}

// Sair do app esconde na hora e, depois de um tempo, tranca de verdade (§20).
let lockTask = null;
export function lock(reason = 'manual') {
  if (lockTask) return lockTask;
  if (!S.unlocked || S.locking) return Promise.resolve();
  S.locking = true;
  emit('locking');
  lockTask = (async () => {
  // Pare mídia e microfone antes de esperar disco/rotação/rede.
  setSensitiveSession(false);
  // Se a rotação começou pelo temporizador, espere sua transação terminar
  // antes de bloquear/apagar. Nunca deixe um rebuild continuar depois da
  // limpeza do cofre; isso pode recriar arquivos que estavam sendo apagados.
  if (rotating) await rotating.catch((e) => console.error('rotação em curso falhou', e?.message));
  // Algo foi apagado e a rotação ainda não rodou: roda antes de trancar.
  if (dirty && reason !== 'wipe') await rotate().catch((e) => console.error('rotação falhou', e?.message));
  S.unlocked = false;
  S.kek = null;
  clearTimeout(rotateTimer);
  // Nada legível fica na memória da página depois de trancar.
  S.nicknames = {};
  S.rooms = {};
  S.prefs = {};
  viewCache.clear();
  lastRoomSnap = null;
  directPending.clear();
  clearVisuals();
  disconnectLive();
  S.client = null;
  await S.store?.lock();
  S.locking = false;
  emit({ locked: reason });
  })().finally(() => { lockTask = null; });
  return lockTask;
}

export async function wipeEverything() {
  await discardAttachment();
  // Antes de destruir as chaves: cancela notificações e encerra a sessão no servidor.
  // Mesmo trancado (PIN de coação), o token/assinatura do aparelho some.
  try { await push.disablePush(S.unlocked ? S.client.api : null); } catch {}
  if (S.unlocked) {
    try { await S.client.api.post('/v1/auth/logout'); } catch {}
  }
  await lock('wipe');
  await S.store?.wipe();
  // Arquivos do banco que não chegaram a ser abertos nesta sessão também saem.
  try { const root = await navigator.storage.getDirectory(); for await (const [name] of root.entries()) await root.removeEntry(name, { recursive: true }).catch(() => {}); } catch {}
  await native.nativeDestroy();
  await idbDestroy();
}

// ---------- proteções de emergência (ADR 0014) ----------
export async function vaultInfo() { const r = await vaultStore.load(); return { vaultId: r?.vaultId ?? null, mode: r?.mode }; }
export async function setDeadDays(days) {
  const { vaultId } = await vaultInfo();
  await S.client.api.post('/v1/vault/settings', { vaultId, deadDays: days });
  await setPrefs({ deadDays: days });
}
// PIN de coação: pede o Face ID de novo (mesma passkey) para derivar.
export async function setDuressPin(pin) {
  const rec = await vaultStore.load();
  let prf = null;
  if (rec.mode === 'passkey') prf = rec.credentialId === native.NATIVE_ID ? await native.nativeSecret() : await passkey.evaluate(rec.credentialId, vault.unb64(rec.prfSalt));
  try {
    const duress = pin ? await vault.duressVerifier(rec, { prf, secret: pin }) : null;
    await S.client.api.post('/v1/vault/settings', { vaultId: rec.vaultId, duress });
    await setPrefs({ duressSet: !!pin });
  } finally { prf?.fill(0); }
}
const KILL_ABC = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
async function sha256hex(t) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map((x) => x.toString(16).padStart(2, '0')).join(''); }
// Código de emergência: 24 caracteres sem letras parecidas; o servidor guarda
// só o resumo. Mostrado uma vez para a pessoa anotar no papel.
export async function createKillCode() {
  const out = [];
  while (out.length < 24) for (const x of crypto.getRandomValues(new Uint8Array(48))) if (x < 224 && out.length < 24) out.push(KILL_ABC[x % 56]);
  const code = out.join('');
  await S.client.api.post('/v1/vault/kill-code', { codeHash: await sha256hex(code) });
  await setPrefs({ killCodeSet: true });
  return code;
}
// De qualquer aparelho, sem conta: mata os aparelhos de quem tem o código.
export async function useKillCode(code) {
  const res = await fetch(`${CONFIG.api}/v1/vault/kill`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: code.replace(/\s+/g, '') }) });
  if (!res.ok) throw new Error('Não deu para enviar. Confira a internet e tente de novo.');
}

// ---------- sincronização ----------
// Um pedido que chega durante uma sincronização em curso (ex.: aviso do
// WebSocket) não pode se perder: marca `again` e o laço roda mais uma vez.
let syncing = null, again = false;
export function syncNow() {
  if (!S.unlocked || S.locking) return Promise.resolve();
  if (syncing) { again = true; return syncing; }
  const client = S.client;
  return (syncing = (async () => {
    try {
      do {
        again = false;
        let more = true, rounds = 0;
        while (more && rounds++ < 10 && S.unlocked) {
          const r = await S.client.sync();
          if (r.security?.some((e) => e.kind === 'joined' || e.kind === 'recovered' || e.kind === 'device_changed')) announceCheck = true;
          if (r.rejected.length) console.warn('mensagens recusadas', r.rejected.length); // sem id nem remetente em log
          await handleExtras(r.received);
          more = r.more;
        }
        if (!S.unlocked) break;
        if (S.clock.now() && (await S.store.purgeExpired(S.clock.now())) > 0) scheduleRotate();
        await notes();
        await completeVaultMigration().catch(() => {});
        // Lista do círculo mudou (S3): anuncia o apelido aos recém-confirmados.
        if (S.client.circleRosterChanged) { S.client.circleRosterChanged = false; await announce().catch(() => {}); }
        await maybeAnnounce();
        emit('synced');
      } while (again && S.unlocked);
    } catch (e) {
      // Trancou no meio: não é falha (a próxima abertura sincroniza de novo).
      if (S.unlocked && !S.locking && S.client === client) throw e;
    } finally { syncing = null; again = false; }
  })());
}

async function handleExtras(received) {
  let changed = false;
  for (const m of received) {
    if (m.kind === 'nickname_change' && m.room === CIRCLE_ROOM_ID && !validNickname(m.body.nickname)) {
      const prev = S.nicknames[m.sender];
      S.nicknames[m.sender] = { nickname: m.body.nickname.trim(), at: Date.now(), photo: 'photo' in m.body ? m.body.photo : prev?.photo ?? null, about: 'about' in m.body ? m.body.about : prev?.about ?? null };
      if (prev?.photo && prev.photo.mediaId !== S.nicknames[m.sender].photo?.mediaId) forgetVisual(prev.photo);
      changed = true;
    }
    if (m.kind === 'room_profile') {
      // Nome do grupo só da líder confirmada de ponta a ponta (não do servidor).
      // F03: conversa excluída por mim não recupera nome/foto por anúncio velho.
      if (S.client.trusted[m.room]?.leader === m.sender && !S.rooms[m.room]?.deleted) {
        const prev = S.rooms[m.room] ?? {};
        const next = { ...prev, title: m.body.title, description: m.body.description ?? null };
        for (const k of ['photo', 'background']) if (k in m.body) { next[k] = m.body[k]; if (prev[k] && prev[k].mediaId !== m.body[k]?.mediaId) forgetVisual(prev[k]); }
        S.rooms[m.room] = next;
        changed = true;
      }
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
  S.nicknames[S.client.userId] = { ...(S.nicknames[S.client.userId] ?? {}), nickname: nick.trim(), at: Date.now() };
  await S.store.put('nicknames', S.nicknames);
  await announce();
}

async function announce() {
  const nick = myNickname();
  if (!nick) return;
  const view = await roomView(CIRCLE_ROOM_ID, true);
  if (view && view.members.filter((m) => m.active).length > 1) await S.client.sendInner(CIRCLE_ROOM_ID, 'nickname_change', { nickname: nick, photo: S.nicknames[S.client.userId]?.photo ?? null, about: S.nicknames[S.client.userId]?.about ?? null });
  await S.store.put('lastAnnounce', { at: Date.now(), members: view?.members.filter((m) => m.active).length ?? 0 });
}

// Reanuncia quando entra alguém novo (ou troca de aparelho) e a cada 7 dias
// (o prazo máximo é 15). Só consulta os membros do círculo quando há motivo:
// em rede lenta (Tor) cada ida e volta conta. A marca só sai depois de o
// anúncio dar certo (se a pessoa nova ainda não tinha chaves, tenta de novo).
let announceCheck = true;
async function maybeAnnounce() {
  if (!myNickname()) return;
  const last = (await S.store.get('lastAnnounce')) ?? { at: 0, members: 0 };
  const due = Date.now() - last.at > REANNOUNCE_MS;
  if (!announceCheck && !due) return;
  const view = await roomView(CIRCLE_ROOM_ID, true);
  const n = view?.members.filter((m) => m.active).length ?? 0;
  if (n > last.members || due) await announce();
  announceCheck = false;
}

// N2: só quem ainda está no círculo aparece na busca.
export const isActiveMember = (userId) => S.client.known[userId]?.state !== 'removed';
export function searchPeople(term) {
  const dir = Object.entries(S.nicknames).filter(([userId]) => isActiveMember(userId)).map(([userId, n]) => ({ userId, nickname: n.nickname }));
  return searchByPrefix(dir, term, { self: S.client.userId });
}

// ---------- rascunhos ----------
// Só neste aparelho, dentro do banco cifrado (secure_delete apaga as páginas
// antigas). Somem ao enviar e não passam do prazo máximo de 15 dias.
const DRAFT_TTL = 15 * 86_400_000;
export async function getDraft(roomId) {
  const d = ((await S.store.get('drafts')) ?? {})[roomId];
  return d && Date.now() - d.at < DRAFT_TTL ? d.text : '';
}
export async function setDraft(roomId, text) {
  if (!S.unlocked) return;
  const all = (await S.store.get('drafts')) ?? {};
  for (const [k, d] of Object.entries(all)) if (Date.now() - d.at >= DRAFT_TTL) delete all[k];
  if (text) all[roomId] = { text, at: Date.now() }; else delete all[roomId];
  await S.store.put('drafts', all);
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
  for (const [id, r] of Object.entries(S.rooms)) if (r?.left && !r.deleted && !ids.includes(id)) ids.push(id);
  for (const id of ids) if (!S.rooms[id]) S.rooms[id] = {};
  const views = await Promise.all(ids.map((id) => roomView(id)));
  // E3: guarda a lista (cifrada, no banco do aparelho) para a próxima abertura
  // desenhar sem esperar a rede. Só grava quando mudou.
  const snap = Object.fromEntries(views.filter(Boolean).map((v) => [v.roomId, v]));
  const json = JSON.stringify(snap);
  if (json !== lastRoomSnap && S.unlocked) { lastRoomSnap = json; await S.store.put('roomViews', snap).catch(() => {}); }
  return views;
}
let lastRoomSnap = null;
// Lista da última abertura, para desenhar na hora; a tela pede a atual logo depois.
export async function cachedRooms() {
  const saved = await S.store.get('roomViews').catch(() => null);
  return saved ? Object.values(saved) : null;
}

const directPending = new Map();
export function startDirect(userId) {
  if (!S.unlocked || !S.client) return Promise.reject(new Error('app bloqueado'));
  if (directPending.has(userId)) return directPending.get(userId);
  const client = S.client;
  const task = (async () => {
    const v = await client.createRoom('direct', [userId]);
    if (v.created === false) await syncNow();
    if (!S.unlocked || S.client !== client) throw new Error('sessão encerrada');
    S.rooms[v.roomId] ??= {};
    await undeleteRoom(v.roomId);
    await S.store.put('rooms', S.rooms);
    viewCache.set(v.roomId, v);
    return v;
  })();
  directPending.set(userId, task);
  task.finally(() => { if (directPending.get(userId) === task) directPending.delete(userId); }).catch(() => {});
  return task;
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
  S.rooms[roomId] = { ...(S.rooms[roomId] ?? {}), title };
  await sendRoomProfile(roomId);
}
// O perfil do grupo (nome, foto, fundo) vai inteiro, cifrado, da líder.
// Reenviado também quando entra alguém, para a pessoa nova ver.
export async function sendRoomProfile(roomId) {
  const r = S.rooms[roomId] ?? {};
  await S.client.sendInner(roomId, 'room_profile', { title: r.title ?? '', photo: r.photo ?? null, background: r.background ?? null, ...(r.description ? { description: r.description } : {}) });
  await S.store.put('rooms', S.rooms);
}

// ---------- preferências deste aparelho ----------
// Modo máximo (padrão): foto e vídeo só pela câmera do app, nunca da galeria
// (o original da galeria tem GPS/modelo e o sistema faz cópia temporária).
export const DEFAULT_PREFS = Object.freeze({ maxMode: true, lockAfter: 0 });
export async function setPrefs(patch) {
  S.prefs = { ...S.prefs, ...patch };
  await S.store.put('prefs', S.prefs);
}
export const maxMode = () => S.prefs.maxMode !== false;

// ---------- organização local da conversa (§18) ----------
export async function setRoomFlag(roomId, patch) {
  S.rooms[roomId] = { ...(S.rooms[roomId] ?? {}), ...patch };
  await S.store.put('rooms', S.rooms);
}
// Silenciar: o servidor só deixa de mandar push desta conversa para mim.
export async function muteRoom(roomId, until) {
  const r = await S.client.api.post(`/v1/rooms/${roomId}/mute`, { until });
  await setRoomFlag(roomId, { mutedUntil: r.until });
}
export const isMuted = (roomId) => (S.rooms[roomId]?.mutedUntil ?? 0) > Date.now();

// ---------- lista como no WhatsApp (entrega B) ----------
// Tudo aqui é só deste aparelho, dentro do banco cifrado. Nada vai ao
// servidor: nem lido/não lido, nem prévia, nem conversa excluída.
export const MAX_PINNED = 3; // D9
export async function togglePin(roomId) {
  const on = !S.rooms[roomId]?.pinned;
  if (on && Object.values(S.rooms).filter((r) => r?.pinned && !r.deleted).length >= MAX_PINNED) throw new Error(`Dá para fixar até ${MAX_PINNED} conversas.`);
  await setRoomFlag(roomId, { pinned: on });
  return on;
}
const now = () => S.clock?.now() ?? Date.now();
// Contador (D2): mensagens recebidas, válidas, ainda não vistas. Reação,
// edição e eventos não são mensagens guardadas, então não contam.
export function unreadCount(roomId, render) {
  const r = S.rooms[roomId] ?? {};
  const readAt = r.readAt ?? 0;
  const n = render.filter((m) => m.sender !== S.client.userId && m.acceptedAt > readAt).length;
  return n || (r.markedUnread ? 1 : 0);
}
// Marcar como lida até a mensagem que apareceu na tela (D2): a posição de
// leitura importa, então quem lê lá em cima não zera o contador.
export async function markRead(roomId, upTo) {
  const r = S.rooms[roomId] ?? {};
  if ((r.readAt ?? 0) >= upTo && !r.markedUnread) return;
  await setRoomFlag(roomId, { readAt: Math.max(r.readAt ?? 0, upTo), markedUnread: false });
}
export const markUnread = (roomId) => setRoomFlag(roomId, { markedUnread: true }); // D10
// Prévia da última mensagem (D2). Nunca abre mídia nem cria miniatura; ver
// uma vez aparece só como rótulo. Com a opção desligada: "Nova mensagem".
export function previewOf(view, last) {
  if (!last) return view.closed ? 'Encerrada' : 'Sem mensagens';
  const who = last.sender === S.client.userId ? 'Você: ' : view.kind === 'group' ? `${nameOf(last.sender)}: ` : '';
  let what;
  if (last.kind === 'media') {
    const mime = last.body?.mime ?? '';
    const base = last.body?.mode === 'doc' ? 'Documento' : /^audio\//.test(mime) ? 'Áudio' : /^video\//.test(mime) ? 'Vídeo' : 'Foto';
    what = last.body?.mode === 'once' ? `${base} de ver uma vez` : last.body?.caption ? `${base} · ${last.body.caption}` : base;
  } else if (last.kind === 'poll') what = `Enquete: ${last.body?.question ?? ''}`;
  else what = last.text ?? '';
  return (who + what).replace(/\s+/g, ' ').slice(0, 80);
}
// Limpar (D3): apaga as mensagens só deste aparelho; a conversa fica.
export async function clearRoom(roomId) {
  const n = await S.client.clearRoomForMe(roomId);
  await setRoomFlag(roomId, { readAt: now(), markedUnread: false });
  return n;
}
// Excluir (D3, F03): some da MINHA lista com mensagens, rascunho, prévia,
// contador e nome/foto/fundo locais. Os outros continuam com tudo. Volta se
// chegar mensagem nova (aceita depois da exclusão, pelo relógio do servidor).
export async function deleteRoomForMe(roomId) {
  await S.client.clearRoomForMe(roomId);
  await setDraft(roomId, '');
  await setWallpaper(roomId, null);
  const prev = S.rooms[roomId] ?? {};
  for (const k of ['photo', 'background']) if (prev[k]) forgetVisual(prev[k]);
  S.rooms[roomId] = { deleted: true, deletedAt: now(), ...(prev.left ? { left: true } : {}) };
  await S.store.put('rooms', S.rooms);
  viewCache.delete(roomId);
  const snap = (await S.store.get('roomViews')) ?? {};
  if (snap[roomId]) { delete snap[roomId]; await S.store.put('roomViews', snap); lastRoomSnap = null; }
  scheduleRotate(); // nome e foto antigos saem do arquivo do banco
}
export const isDeleted = (roomId, lastAt = 0) => !!S.rooms[roomId]?.deleted && lastAt <= (S.rooms[roomId].deletedAt ?? 0);
// Abrir de propósito (tocar na pessoa) traz a conversa de volta à lista.
export async function undeleteRoom(roomId) {
  if (S.rooms[roomId]?.deleted) { const { deleted, deletedAt, ...rest } = S.rooms[roomId]; S.rooms[roomId] = { ...rest, readAt: deletedAt }; await S.store.put('rooms', S.rooms); }
}
// Busca nas mensagens de todas as conversas (b.14): só no aparelho, sobre o
// que ainda não venceu; nada é indexado nem guardado.
export async function searchMessages(term, limit = 30) {
  const t = normalize(term ?? '');
  if (t.length < 2) return [];
  const out = [];
  for (const id of Object.keys(S.rooms)) {
    if (S.rooms[id]?.deleted) continue;
    const r = await S.client.view(id).catch(() => null);
    for (const m of r?.render ?? []) {
      const text = m.kind === 'text' ? m.text : m.kind === 'poll' ? m.body?.question : m.body?.mode === 'once' ? '' : m.body?.caption ?? m.body?.name ?? '';
      if (text && normalize(text).includes(t)) out.push({ roomId: id, msg: m, text });
    }
  }
  return out.sort((a, b) => b.msg.acceptedAt - a.msg.acceptedAt).slice(0, limit);
}

// Anotações (D, "conversa comigo"): só neste aparelho, nunca vão ao servidor
// e vencem como qualquer mensagem (passo 9).
let notesWork = Promise.resolve();
const changeNotes = (fn) => {
  const store = S.store;
  const task = notesWork.then(async () => {
    const previous = (await store.get('notes')) ?? [];
    const current = previous.filter((n) => n.expiresAt > now());
    const next = fn ? fn(current) : current;
    if (fn || current.length !== previous.length) {
      await store.put('notes', next);
      if (S.store === store && previous.some((n) => !next.some((v) => v.id === n.id))) scheduleRotate();
      if (current.length !== previous.length) emit('notes');
    }
    return next;
  });
  notesWork = task.catch(() => {});
  return task;
};
export const notes = () => changeNotes();
export async function addNote(text, ttlSec) {
  const now = S.clock?.now() ?? Date.now();
  if (!Number.isSafeInteger(ttlSec) || ttlSec < 43200 || ttlSec > 15 * 86400) throw new Error('Prazo inválido.');
  await changeNotes((all) => [...all, { id: crypto.randomUUID(), text: text.slice(0, 4000), at: now, expiresAt: now + ttlSec * 1000 }]);
}
export async function deleteNote(id) {
  await changeNotes((all) => all.filter((n) => n.id !== id));
}

// Papel de parede só deste aparelho (b.17), cifrado no banco.
export async function setWallpaper(roomId, bytes) {
  const all = (await S.store.get('wallpapers')) ?? {};
  if (bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); all[roomId] = btoa(s); } else delete all[roomId];
  await S.store.put('wallpapers', all);
  if (!bytes) scheduleRotate();
}
export async function wallpaperURL(roomId) {
  const b = ((await S.store.get('wallpapers')) ?? {})[roomId];
  if (!b) return null;
  return URL.createObjectURL(new Blob([Uint8Array.from(atob(b), (c) => c.charCodeAt(0))], { type: 'image/jpeg' }));
}

// Descrição do grupo (b.16): cifrada, como o nome; só a líder muda.
export async function setRoomDescription(roomId, description) {
  S.rooms[roomId] = { ...(S.rooms[roomId] ?? {}), description: description || null };
  await sendRoomProfile(roomId);
}

// Saiu do grupo: continua na lista só para leitura até excluir (WhatsApp).
export const markLeft = (roomId) => setRoomFlag(roomId, { left: true });
export const imActive = (view) => !!view?.members.some((m) => m.userId === S.client.userId && m.active);

// ---------- fotos de perfil, de grupo e fundo (§21) ----------
// Decifradas só em memória; trancar o app solta tudo.
const visualCache = new Map();
export function visualURL(ref) {
  if (!ref?.mediaId || !S.unlocked) return Promise.resolve(null);
  if (!visualCache.has(ref.mediaId)) {
    visualCache.set(ref.mediaId, S.client.openVisual(ref).then((bytes) => {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
      bytes.fill(0);
      return url;
    }).catch(() => { visualCache.delete(ref.mediaId); return null; }));
  }
  return visualCache.get(ref.mediaId);
}
function forgetVisual(ref) {
  const p = visualCache.get(ref?.mediaId);
  if (p) { visualCache.delete(ref.mediaId); p.then((u) => u && URL.revokeObjectURL(u)); }
}
function clearVisuals() {
  for (const p of visualCache.values()) p.then((u) => u && URL.revokeObjectURL(u));
  visualCache.clear();
}
export const photoOf = (userId) => S.nicknames[userId]?.photo ?? null;
export function roomPhoto(view) {
  if (!view) return null;
  if (view.kind === 'direct') return photoOf(view.members.find((m) => m.userId !== S.client.userId)?.userId);
  return S.rooms[view.roomId]?.photo ?? null;
}

// Recado (§18): frase curta, cifrada, só para o círculo.
export async function setAbout(text) {
  const me = S.client.userId;
  const about = (text ?? '').trim().slice(0, 140) || null;
  S.nicknames[me] = { ...(S.nicknames[me] ?? {}), about };
  await S.store.put('nicknames', S.nicknames);
  await announce();
}
export const aboutOf = (userId) => S.nicknames[userId]?.about ?? null;

export async function setProfilePhoto(bytes) {
  const me = S.client.userId;
  const old = S.nicknames[me]?.photo;
  const ref = bytes ? await S.client.setVisual('user', me, 'profile', bytes) : (await S.client.removeVisual('user', me, 'profile'), null);
  S.nicknames[me] = { ...(S.nicknames[me] ?? {}), photo: ref };
  if (old) forgetVisual(old);
  await S.store.put('nicknames', S.nicknames);
  await announce();
}
export async function setRoomVisual(roomId, slot, bytes) {
  const old = S.rooms[roomId]?.[slot];
  const ref = bytes ? await S.client.setVisual('room', roomId, slot, bytes) : (await S.client.removeVisual('room', roomId, slot), null);
  S.rooms[roomId] = { ...(S.rooms[roomId] ?? {}), [slot]: ref };
  if (old) forgetVisual(old);
  await sendRoomProfile(roomId);
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

// S8: número de segurança da DUPLA (como o WhatsApp/Signal): metade de cada
// chave, em ordem fixa, então os dois aparelhos mostram o mesmo número.
export async function safetyNumber(userId) {
  const theirs = S.client.known[userId]?.curve;
  if (!theirs) return null;
  const halves = await Promise.all([S.client.account.curve25519Key, theirs].sort().map(async (k) => (await fingerprint(k)).split(' ').slice(0, 6).join(' ')));
  return halves.join(' ');
}
// Conteúdo do QR: as duas chaves públicas em ordem fixa (nada secreto).
export function verifyPayload(userId) {
  const theirs = S.client.known[userId]?.curve;
  return theirs ? `mp-verify:1:${[S.client.account.curve25519Key, theirs].sort().join(':')}` : null;
}
export const isVerified = (userId) => S.client.isVerified(userId);
// S3: lista do círculo confirmada pela administradora.
export function circlePending(userId) {
  const roster = S.client.circleRoster();
  if (userId === S.client.circleAdmin) return false;
  return roster ? !roster.includes(userId) : true;
}
export function circlePendingCount() {
  return Object.entries(S.client.known).filter(([u, k]) => k.state !== 'removed' && u !== S.client.userId && circlePending(u)).length;
}
export async function confirmCircle(members) {
  await S.client.confirmCircle(members);
  await announce().catch(() => {});
}
export const isCircleAdmin = async () => (await S.client.circleAdminId()) === S.client.userId;
export const keyChanged = (userId) => S.client.keyChangedSinceVerified(userId);
export async function setVerified(userId, on, expected = verifyPayload(userId)) {
  const client = S.client;
  if (!client || expected !== verifyPayload(userId)) throw new Error('chave alterada durante a conferência');
  await client.setVerified(userId, on, { curve: client.known[userId]?.curve, own: client.account.curve25519Key });
  emit('verified');
}
// Avisos de segurança desta conversa (S1): troca de chave de quem está nela.
export function roomWarnings(view) {
  const ids = new Set(view.members.filter((m) => m.active && m.userId !== S.client.userId).map((m) => m.userId));
  return S.client.warnings.filter((w) => w.kind === 'key_changed' && ids.has(w.userId));
}

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

export const pushEnabled = () => S.prefs.push === true;
export const pushState = () => push.pushState(pushEnabled());
export async function setPush(on, opts) {
  if (on) {
    await push.enablePush(S.client.api, opts);
    await setPrefs({ push: true });
    return;
  }
  await setPrefs({ push: false });
  await push.disablePush(S.client.api);
}
