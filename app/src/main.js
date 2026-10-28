// Casca do app: instância única (V7-013), capa ao sair do app e bloqueio
// automático (§20), roteamento entre telas.
import './tt.js';
import { CONFIG as BUILD } from './config.js';
// Release: nada vai para o console (no Android o console do WebView pode
// parar no logcat; no iPhone, no Web Inspector). Só builds de teste falam.
if (!BUILD.testHooks && !BUILD.devBuild) for (const k of ['log', 'info', 'warn', 'error', 'debug', 'trace']) console[k] = () => {};
import { h, mount, toast, clearOverlays } from './ui.js';
import { CONFIG } from './config.js';
import { scriptURL } from './tt.js';
import { cancelSensitiveOperations } from './sensitive-scope.js';
import * as trip from './picker-trip.js';
import * as session from './session.js';
import { welcome, pairWaitScreen } from './screens/welcome.js';
import { unlockScreen } from './screens/unlock.js';
import { chatsScreen } from './screens/chats.js';
import { chatScreen } from './screens/chat.js';
import { newGroupScreen } from './screens/new-group.js';
import { nicknameScreen } from './screens/nickname.js';
import { settingsScreen } from './screens/settings.js';
import { storiesScreen } from './screens/stories.js';
import { notesScreen } from './screens/notes.js';

// Tranca de verdade (chaves saem da memória) ao sair do app: na hora por
// padrão; em Ajustes dá para escolher 1 ou 5 minutos.
const lockAfter = () => session.S.prefs?.lockAfter ?? 0;
const routes = { welcome, pairWait: pairWaitScreen, unlock: unlockScreen, chats: chatsScreen, chat: chatScreen, newGroup: newGroupScreen, nickname: nicknameScreen, settings: settingsScreen, stories: storiesScreen, notes: notesScreen };
const open = new Set(['welcome', 'unlock', 'pairWait']);
let cleanup = null, routeVersion = 0;

export async function go(name, params = {}) {
  const version = ++routeVersion;
  cancelSensitiveOperations();
  try { cleanup?.(); } catch {}
  cleanup = null;
  if (!open.has(name) && !session.S.unlocked) name = (await session.hasVault()) ? 'unlock' : 'welcome';
  if (version !== routeVersion) return;
  try {
    const r = await routes[name](go, params);
    if (version !== routeVersion) { if (typeof r === 'function') r(); return; }
    if (typeof r === 'function') cleanup = r;
    if (open.has(name) && !session.S.locking) cover(false);
  } catch (e) {
    console.error(e);
    toast(`Erro: ${e.message}`);
  }
}

// Capa imediata ao perder o foco: o seletor de apps não mostra conteúdo.
let hiddenAt = 0, tripTimer = null;
function cover(on) { document.documentElement.classList.toggle('covered', on || session.S.locking); }
function setupPrivacy() {
  const hide = () => { cover(true); hiddenAt ||= Date.now(); };
  addEventListener('blur', hide);
  addEventListener('pagehide', hide);
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) {
      hide();
      // D13: foi ao seletor que o próprio app abriu. Não tranca agora, mas
      // tranca sozinho quando a janela de 2 minutos acabar.
      if (session.S.unlocked && trip.pickerTripActive()) {
        clearTimeout(tripTimer);
        // Quem escolheu trancar depois de 5 min não tranca antes por causa disso.
        tripTimer = setTimeout(() => { if (document.hidden && session.S.unlocked) session.lock('timeout'); }, Math.max(trip.pickerTripLeft(), lockAfter()));
        return;
      }
      // A tela de desbloqueio vem do aviso de "trancado" (uma vez só).
      if (session.S.unlocked && lockAfter() === 0) await session.lock('hidden');
      return;
    }
    const away = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = 0;
    clearTimeout(tripTimer);
    const quickTrip = trip.pickerTripActive();
    trip.endPickerTrip();
    if (session.S.unlocked && !quickTrip && away > lockAfter()) { await session.lock('timeout'); await go('unlock'); }
    cover(false);
    if (session.S.unlocked) session.syncNow().catch(() => {});
  });
  addEventListener('focus', () => { if (!document.hidden) cover(false); });
  session.onChange(async (w) => {
    if (w === 'locking') cover(true);
    if (w?.locked) clearOverlays();
    if (w?.locked && w.locked !== 'wipe') { await go('unlock'); cover(false); }
  });
}

async function registerSW() {
  if (!CONFIG.serviceWorker || !('serviceWorker' in navigator)) return;
  try { await navigator.serviceWorker.register(scriptURL('sw.js'), { scope: './', updateViaCache: 'none' }); } catch (e) { console.warn('service worker', e?.name); }
}

async function start() {
  // Só em build de teste (MP_TEST_HOOKS=1, modo plain): expõe a sessão.
  if (CONFIG.testHooks) { globalThis.__mpTest = session; globalThis.__mpTrip = trip; }
  setupPrivacy();
  await registerSW();
  try { await navigator.storage?.persist?.(); } catch {}
  await go((await session.hasVault()) ? 'unlock' : 'welcome');
}

if ('locks' in navigator) {
  navigator.locks.request('mp-instance', { ifAvailable: true }, (lock) => {
    if (!lock) { mount(h('main', { class: 'center' }, h('p', { text: 'O app já está aberto em outra aba ou janela.' }))); return; }
    start();
    return new Promise(() => {}); // segura a trava enquanto a página viver
  });
} else start();
