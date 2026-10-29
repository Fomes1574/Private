// O que o disfarce guarda fora do banco cifrado (o banco só abre depois do
// PIN): se está ligado, recorde e opções do jogo, e as tentativas erradas do
// código. Nada disso é conversa nem chave.
import { idbGet, idbPut } from '../idb.js';

export const HOLD_MS = 30 * 60_000;
// Na 4ª tentativa errada seguida, o Recorde para de responder por 30 min. A
// 5ª errada continua apagando os dados (o servidor conta, como sempre).
export const WRONG_BEFORE_HOLD = 4;
// Sobrevivem a "apagar tudo": depois de apagar, o celular mostra o mesmo jogo.
export const KEEP_ON_WIPE = ['disguise', 'snakeBest', 'snakePrefs'];
export const DEFAULT_PREFS = Object.freeze({ mode: 'classic', speed: 'normal', control: 'swipe', sound: true, vibrate: true });

const get = (k) => idbGet(k).catch(() => undefined);
const put = (k, v) => idbPut(k, v).catch(() => {});

let on = null;
export async function isOn() { return (on ??= (await get('disguise')) === true); }

export async function setOn(value) {
  on = !!value;
  await idbPut('disguise', on ? true : undefined);
  apply(on);
  // Android: troca o ícone e o nome na tela inicial (activity-alias).
  const native = globalThis.Capacitor?.isNativePlatform?.() ? globalThis.Capacitor.Plugins?.Disguise : null;
  if (native) { try { await native.set({ on }); } catch (e) { console.warn('disfarce nativo', e?.message); } }
}

// Título, ícone e nome que o iPhone usa ao "Adicionar à Tela de Início".
export function apply(value) {
  const doc = document;
  doc.documentElement.classList.toggle('disguise', value);
  doc.title = value ? 'Hungry Snake' : 'Pacto Talk';
  const link = (rel) => doc.querySelector(`link[rel="${rel}"]`);
  link('apple-touch-icon')?.setAttribute('href', value ? 'snake-180.png' : 'icon-180.png');
  link('manifest')?.setAttribute('href', value ? 'snake.webmanifest' : 'manifest.webmanifest');
  let title = doc.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (!title) { title = doc.createElement('meta'); title.setAttribute('name', 'apple-mobile-web-app-title'); doc.head.append(title); }
  title.setAttribute('content', value ? 'Hungry Snake' : 'Pacto Talk');
}

export async function loadPrefs() { return { ...DEFAULT_PREFS, ...((await get('snakePrefs')) ?? {}) }; }
export const savePrefs = (p) => put('snakePrefs', { ...p });
export async function loadBest() { const b = await get('snakeBest'); return Number.isSafeInteger(b) && b > 0 ? b : 0; }
export const saveBest = (n) => put('snakeBest', n);

// Relógio adiantado ou atrasado não estica a pausa além de 30 min.
export async function holdActive(now = Date.now()) {
  const h = await get('snakeHold');
  return !!h && h.until > now && h.until - now <= HOLD_MS;
}
export async function noteWrong(now = Date.now()) {
  const h = (await get('snakeHold')) ?? { wrong: 0, until: 0 };
  const wrong = (h.wrong | 0) + 1;
  const hold = wrong >= WRONG_BEFORE_HOLD;
  await put('snakeHold', hold ? { wrong: 0, until: now + HOLD_MS } : { wrong, until: 0 });
  return hold;
}
export const clearWrong = () => put('snakeHold', undefined);
