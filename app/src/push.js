// Notificações, dois caminhos explícitos (nada é adivinhado):
// - 'android': APK (Capacitor). Sem Firebase/Google por decisão (24/10/2026):
//   no Android não há aviso com o app fechado; com o app aberto as mensagens
//   chegam pela conexão própria do app. O caminho nativo abaixo só roda se um
//   APK futuro trouxer o plugin NovasMensagens.
// - 'web': navegador e iPhone (PWA na Tela de Início). Web Push pelo service
//   worker, que mostra "novas mensagens".
// O servidor recebe só o destino DESTE aparelho. Ninguém do círculo fica
// sabendo qual aparelho os outros usam.
import { unb64 } from './vault/vault.js';

const TIMEOUT = 20_000;
const NO_ANDROID_PUSH = 'No Android o app não usa serviços do Google (privacidade): não há aviso com o app fechado. Com o app aberto, as mensagens chegam na hora.';
const plugin = () => (globalThis.Capacitor?.isNativePlatform?.() ? globalThis.Capacitor.Plugins?.NovasMensagens ?? null : null);
export const pushEnv = () => (globalThis.Capacitor?.isNativePlatform?.() ? 'android' : 'web');

export class PushError extends Error {
  constructor(state, message) { super(message); this.state = state; }
}

function limit(p, what) {
  let t;
  return Promise.race([p, new Promise((_, no) => { t = setTimeout(() => no(new PushError('error', `${what} não respondeu.`)), TIMEOUT); })]).finally(() => clearTimeout(t));
}

async function webRegistration() {
  // `serviceWorker.ready` espera para sempre se não houver service worker;
  // getRegistration responde na hora.
  const reg = await limit(navigator.serviceWorker?.getRegistration?.() ?? Promise.resolve(null), 'O navegador');
  if (!reg?.pushManager || !('Notification' in globalThis)) {
    throw new PushError('unavailable', /iPhone|iPad/.test(navigator.userAgent)
      ? 'No iPhone, as notificações só funcionam no app instalado na Tela de Início (Compartilhar → Adicionar à Tela de Início).'
      : 'Este navegador não oferece notificações aqui.');
  }
  return reg;
}

const keyBytes = (key) => unb64(key.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((key.length + 3) % 4));

// Situação atual, sem pedir nada a ninguém.
// on | off | denied | unavailable | error
export async function pushState(enabled) {
  try {
    if (pushEnv() === 'android') {
      const p = plugin();
      if (!p) return { state: 'unavailable', detail: NO_ANDROID_PUSH };
      const st = await limit(p.status(), 'O Android');
      if (!st.configured) return { state: 'unavailable', detail: 'Este APK foi gerado sem a configuração do Firebase. Peça à administradora um APK novo.' };
      if (st.permission === 'denied') return { state: 'denied' };
      return { state: enabled && st.permission === 'granted' ? 'on' : 'off' };
    }
    await webRegistration();
    if (Notification.permission === 'denied') return { state: 'denied' };
    return { state: enabled && Notification.permission === 'granted' ? 'on' : 'off' };
  } catch (e) {
    return { state: e.state ?? 'error', detail: e.message };
  }
}

// Ativar: pede a permissão (só aqui, quando a pessoa toca) e entrega o
// destino ao servidor. `onWaiting` avisa a tela que o sistema está perguntando.
export async function enablePush(api, { onWaiting } = {}) {
  if (pushEnv() === 'android') {
    const p = plugin();
    if (!p) throw new PushError('unavailable', NO_ANDROID_PUSH);
    let st = await limit(p.status(), 'O Android');
    if (!st.configured) throw new PushError('unavailable', 'Este APK foi gerado sem a configuração do Firebase. Peça à administradora um APK novo.');
    if (st.permission !== 'granted') {
      onWaiting?.();
      st = await p.requestPermission(); // sem limite de tempo: a pessoa está decidindo
    }
    if (st.permission !== 'granted') throw new PushError('denied', 'Permissão recusada. Para ativar depois, libere as notificações do Pacto Talk nas configurações do Android.');
    const { token } = await limit(p.token(), 'O serviço de notificações').catch((e) => { throw new PushError('error', `Não deu para registrar: ${e.message}`); });
    await api.post('/v1/push', { fcm: token });
    return;
  }
  const reg = await webRegistration();
  if (Notification.permission !== 'granted') {
    onWaiting?.();
    if (await Notification.requestPermission() !== 'granted') throw new PushError('denied', 'Permissão recusada. Para ativar depois, libere as notificações nas configurações do navegador ou do iPhone.');
  }
  const { key } = await api.get('/v1/push/key');
  if (!key) throw new PushError('error', 'O servidor está sem chave de notificação.');
  const sub = (await reg.pushManager.getSubscription()) ?? await limit(reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }), 'O serviço de notificações');
  await api.post('/v1/push', { endpoint: sub.endpoint });
}

// Desativar: o servidor esquece o destino primeiro; depois o aparelho apaga
// o token (FCM) ou a assinatura (Web Push).
export async function disablePush(api) {
  let err = null;
  if (api) await api.post('/v1/push', { endpoint: null }).catch((e) => { err = e; });
  try {
    if (pushEnv() === 'android') await limit(plugin()?.unregister() ?? Promise.resolve(), 'O Android');
    else await (await (await navigator.serviceWorker?.getRegistration?.())?.pushManager?.getSubscription())?.unsubscribe();
  } catch (e) { err ??= e; }
  if (err) throw new PushError('error', 'Não deu para desligar por completo. Tente de novo com internet.');
}

// A cada desbloqueio: o token pode ter mudado e a permissão pode ter sido
// retirada nas configurações. Sem permissão, o servidor esquece o destino
// (para não mandar avisos que ninguém vê); com permissão, o destino é renovado.
export async function refreshPush(api, enabled) {
  if (!enabled) return;
  const { state } = await pushState(true);
  if (state === 'on') { await enablePush(api).catch(() => {}); return; }
  if (state === 'denied') await api.post('/v1/push', { endpoint: null }).catch(() => {});
}
