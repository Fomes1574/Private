// Visualizadores de mídia. Sem marca d'água, nome, data ou hora sobre a
// imagem (§15, §2.1). Ver uma vez: segurar para ver; soltar, sair do app ou
// perder o foco esconde na hora. Nada de baixar, salvar ou compartilhar.
import { h } from '../ui.js';

let current = null;
function close() {
  if (!current) return;
  const v = current.overlay.querySelector('video');
  if (v) { v.pause(); v.removeAttribute('src'); v.load(); } // solta o decodificador e o blob
  current.overlay.remove();
  URL.revokeObjectURL(current.url);
  current = null;
}
addEventListener('blur', close);
// Ver uma vez: soltar o dedo em QUALQUER lugar fecha (o botão pode ter sido
// redesenhado enquanto a pessoa segurava).
for (const ev of ['pointerup', 'pointercancel']) addEventListener(ev, () => { if (current?.holdOnly) close(); }, true);
addEventListener('pagehide', close);
document.addEventListener('visibilitychange', () => { if (document.hidden) close(); });

function show(bytes, mime, { holdOnly }) {
  close();
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  bytes.fill(0);
  // Vídeo: toca dentro do app; sem baixar, sem picture-in-picture, sem
  // transmitir para outra tela. No ver uma vez não há controles: segurar toca.
  const media = /^video\//.test(mime)
    ? h('video', { src: url, playsinline: true, autoplay: true, disablepictureinpicture: true, disableremoteplayback: true,
      controls: !holdOnly, controlslist: 'nodownload noremoteplayback', preload: 'auto', 'aria-label': holdOnly ? 'Vídeo de visualização única' : 'Vídeo' })
    : h('img', { src: url, alt: holdOnly ? 'Foto de visualização única' : 'Foto', draggable: 'false' });
  const overlay = h('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true', oncontextmenu: (e) => e.preventDefault() }, media,
    holdOnly ? null : h('button', { class: 'viewer-close', 'aria-label': 'Fechar', text: '×', onclick: close }));
  document.body.append(overlay);
  current = { overlay, url, holdOnly };
}

// Foto ou vídeo comum: abre até fechar.
export async function openPhoto(load, mime) { show(await load(), mime, { holdOnly: false }); }
export const openMedia = openPhoto;

// Ver uma vez: o botão precisa ser segurado. A abertura consome o direito.
export function holdButton(label, load, mime, onConsumed) {
  const btn = h('button', { class: 'hold', text: label, oncontextmenu: (e) => e.preventDefault() });
  btn.addEventListener('pointerdown', async (e) => {
    e.preventDefault();
    btn.setPointerCapture?.(e.pointerId);
    try {
      const bytes = await load();
      if (btn.matches(':active') || btn.hasPointerCapture?.(e.pointerId)) show(bytes, mime, { holdOnly: true });
      else bytes.fill(0);
    } catch (err) { onConsumed?.(err); return; }
    onConsumed?.(null);
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, close);
  return btn;
}

// Áudio: toca dentro do app, sem baixar nem compartilhar; 1×, 1,5× e 2×.
let currentAudio = null;
function stopAudio() {
  if (!currentAudio) return;
  currentAudio.el.pause();
  currentAudio.el.removeAttribute('src');
  URL.revokeObjectURL(currentAudio.url);
  currentAudio.box.remove();
  currentAudio = null;
}
document.addEventListener('visibilitychange', () => { if (document.hidden) stopAudio(); });
addEventListener('pagehide', stopAudio);

export async function playAudio(load, mime, host) {
  stopAudio();
  const bytes = await load();
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  bytes.fill(0);
  const el = h('audio', { src: url, controls: true, controlslist: 'nodownload noplaybackrate noremoteplayback', disableremoteplayback: true, preload: 'auto' });
  const speeds = [1, 1.5, 2].map((r) => h('button', { class: 'secondary small', text: `${r.toLocaleString('pt-BR')}×`, onclick: () => { el.playbackRate = r; } }));
  const box = h('div', { class: 'audio-box' }, el, h('div', { class: 'row' }, speeds, h('button', { class: 'secondary small', text: 'Fechar', onclick: stopAudio })));
  host.append(box);
  currentAudio = { el, url, box };
  el.play().catch(() => {});
}
