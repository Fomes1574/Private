// Visualizadores de mídia. Sem marca d'água, nome, data ou hora sobre a
// imagem (§15, §2.1). Ver uma vez: segurar para ver; soltar, sair do app ou
// perder o foco esconde na hora. Nada de baixar, salvar ou compartilhar.
import { h } from '../ui.js';
import { scriptURL } from '../tt.js';

let current = null;
function close() {
  if (!current) return;
  try { current.cleanup?.(); } catch {}
  const v = current.overlay.querySelector('video');
  if (v) { v.pause(); v.removeAttribute('src'); v.load(); } // solta o decodificador e o blob
  current.overlay.remove();
  if (current.url) URL.revokeObjectURL(current.url);
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

// Documento de texto: decodificado como UTF-8 e mostrado SÓ como texto
// (textContent), nunca como HTML; sem baixar, abrir fora ou copiar.
// Documento: o tipo decide o visualizador; o conteúdo confere o tipo.
export async function openDoc(load, name, mime) {
  if (mime === 'application/pdf') return openPdf(load, name);
  return openText(load, name);
}

export async function openText(load, name) {
  close();
  const bytes = await load();
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } finally { bytes.fill(0); }
  const overlay = h('div', { class: 'viewer doc', role: 'dialog', 'aria-modal': 'true', 'aria-label': name || 'Documento', oncontextmenu: (e) => e.preventDefault(), oncopy: (e) => e.preventDefault() },
    h('div', { class: 'doc-head' }, h('span', { text: name || 'Documento' })),
    h('pre', { class: 'doc-text', text }),
    h('button', { class: 'viewer-close', 'aria-label': 'Fechar', text: '×', onclick: close }));
  document.body.append(overlay);
  current = { overlay, url: '', holdOnly: false };
}

// PDF dentro do app (P-12). O pdf.js só DESENHA em <canvas>: sem JavaScript
// do PDF (o sandbox nem é carregado), sem formulários, anotações ou links
// (nada abre outro app ou endereço), sem XFA, sem fontes do sistema nem
// FontFace (glifos viram desenho), sem eval. Nada é salvo: os bytes ficam
// só na memória e são zerados ao fechar.
export const isPdf = (b) => b.length > 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d; // "%PDF-"
const MAX_PAGES = 300;
let pdfLib;
export async function openPdf(load, name) {
  close();
  const bytes = await load();
  if (!isPdf(bytes)) { bytes.fill(0); throw new Error('o arquivo não é um PDF'); }
  pdfLib ??= await import('../vendor/pdfjs/pdf.min.mjs');
  const { getDocument, GlobalWorkerOptions, AnnotationMode } = pdfLib;
  const worker = new Worker(scriptURL(new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href), { type: 'module' });
  GlobalWorkerOptions.workerPort = worker;
  const pages = h('div', { class: 'pdf-pages' });
  const status = h('p', { class: 'muted small pdf-status', role: 'status', text: 'Abrindo…' });
  const overlay = h('div', { class: 'viewer doc pdf', role: 'dialog', 'aria-modal': 'true', 'aria-label': name || 'PDF', oncontextmenu: (e) => e.preventDefault() },
    h('div', { class: 'doc-head' }, h('span', { text: name || 'PDF' })),
    h('div', { class: 'pdf-scroll' }, status, pages),
    h('button', { class: 'viewer-close', 'aria-label': 'Fechar', text: '×', onclick: close }));
  document.body.append(overlay);
  const task = getDocument({
    data: bytes, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, enableXfa: false,
    disableAutoFetch: true, disableStream: true, disableRange: true, useWorkerFetch: false,
    maxImageSize: 40_000_000, stopAtErrors: false, verbosity: 0,
  });
  let closed = false;
  const me = { overlay, url: '', holdOnly: false, cleanup: () => {
    closed = true;
    for (const c of pages.querySelectorAll('canvas')) { c.width = 0; c.height = 0; }
    task.destroy().catch(() => {}).finally(() => worker.terminate());
    bytes.fill(0);
  } };
  current = me;
  try {
    const doc = await task.promise;
    const n = Math.min(doc.numPages, MAX_PAGES);
    status.textContent = doc.numPages > MAX_PAGES ? `Mostrando as primeiras ${MAX_PAGES} de ${doc.numPages} páginas.` : `${n} página${n > 1 ? 's' : ''}`;
    const width = Math.min(overlay.clientWidth || 360, 1200) - 16;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    for (let i = 1; i <= n && !closed; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (width / base.width) * dpr });
      const canvas = h('canvas', { class: 'pdf-page', 'aria-label': `Página ${i}` });
      canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
      pages.append(canvas);
      await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport, annotationMode: AnnotationMode.DISABLE }).promise;
      page.cleanup();
    }
  } catch (e) {
    if (closed) return;
    status.textContent = 'Não deu para abrir este PDF (arquivo danificado ou formato não suportado).';
    throw e;
  }
}
