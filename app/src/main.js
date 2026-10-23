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
import * as session from './session.js';
import { welcome } from './screens/welcome.js';
import { unlockScreen } from './screens/unlock.js';
import { chatsScreen } from './screens/chats.js';
import { chatScreen } from './screens/chat.js';
import { newGroupScreen } from './screens/new-group.js';
import { nicknameScreen } from './screens/nickname.js';
import { settingsScreen } from './screens/settings.js';
import { storiesScreen } from './screens/stories.js';

// Tranca de verdade (chaves saem da memória) ao sair do app: na hora por
// padrão; em Ajustes dá para escolher 1 ou 5 minutos.
const lockAfter = () => session.S.prefs?.lockAfter ?? 0;
const routes = { welcome, unlock: unlockScreen, chats: chatsScreen, chat: chatScreen, newGroup: newGroupScreen, nickname: nicknameScreen, settings: settingsScreen, stories: storiesScreen };
const open = new Set(['welcome', 'unlock']);
let cleanup = null;

export async function go(name, params = {}) {
  try { cleanup?.(); } catch {}
  cleanup = null;
  if (!open.has(name) && !session.S.unlocked) name = (await session.hasVault()) ? 'unlock' : 'welcome';
  try {
    const r = await routes[name](go, params);
    if (typeof r === 'function') cleanup = r;
  } catch (e) {
    console.error(e);
    toast(`Erro: ${e.message}`);
  }
}

// Capa imediata ao perder o foco: o seletor de apps não mostra conteúdo.
let hiddenAt = 0;
function cover(on) { document.documentElement.classList.toggle('covered', on); }
function setupPrivacy() {
  const hide = () => { cover(true); hiddenAt ||= Date.now(); };
  addEventListener('blur', hide);
  addEventListener('pagehide', hide);
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) {
      hide();
      // A tela de desbloqueio vem do aviso de "trancado" (uma vez só).
      if (session.S.unlocked && lockAfter() === 0) await session.lock('hidden');
      return;
    }
    const away = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = 0;
    if (session.S.unlocked && away > lockAfter()) { await session.lock('timeout'); await go('unlock'); }
    cover(false);
    if (session.S.unlocked) session.syncNow().catch(() => {});
  });
  addEventListener('focus', () => { if (!document.hidden) cover(false); });
  session.onChange((w) => {
    if (w?.locked) clearOverlays();
    if (w?.locked && w.locked !== 'wipe') go('unlock');
  });
}

async function registerSW() {
  if (!CONFIG.serviceWorker || !('serviceWorker' in navigator)) return;
  try { await navigator.serviceWorker.register(scriptURL('sw.js'), { scope: './', updateViaCache: 'none' }); } catch (e) { console.warn('service worker', e?.name); }
}

async function start() {
  // Só em build de teste (MP_TEST_HOOKS=1, modo plain): expõe a sessão.
  if (CONFIG.testHooks) globalThis.__mpTest = session;
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
