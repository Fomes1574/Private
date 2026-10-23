// Visualizadores de mídia. Sem marca d'água, nome, data ou hora sobre a
// imagem (§15, §2.1). Ver uma vez: segurar para ver; soltar, sair do app ou
// perder o foco esconde na hora. Nada de baixar, salvar ou compartilhar.
import { h } from '../ui.js';

let current = null;
function close() {
  if (!current) return;
  current.overlay.remove();
  URL.revokeObjectURL(current.url);
  current = null;
}
addEventListener('blur', close);
addEventListener('pagehide', close);
document.addEventListener('visibilitychange', () => { if (document.hidden) close(); });

function show(bytes, mime, { holdOnly }) {
  close();
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  bytes.fill(0);
  const img = h('img', { src: url, alt: holdOnly ? 'Foto de visualização única' : 'Foto', draggable: 'false' });
  const overlay = h('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true', oncontextmenu: (e) => e.preventDefault() }, img,
    holdOnly ? null : h('button', { class: 'viewer-close', 'aria-label': 'Fechar', text: '×', onclick: close }));
  document.body.append(overlay);
  current = { overlay, url };
}

// Foto comum: abre até fechar.
export async function openPhoto(load, mime) { show(await load(), mime, { holdOnly: false }); }

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
