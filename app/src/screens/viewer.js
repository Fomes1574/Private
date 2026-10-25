// Visualizadores vinculados à sessão/tela. D6: tocar para abrir; X/voltar fecha.
import { h } from '../ui.js';
import { scriptURL } from '../tt.js';
import { sensitiveScope } from '../sensitive-scope.js';

let current = null;
export function closeMedia() { current?.scope.cancel(); }
function begin(options = {}) {
  closeMedia();
  const scope = sensitiveScope(options);
  const entry = { scope, overlay: null, url: null, cleanup: null };
  current = entry;
  scope.onCancel(() => {
    if (current === entry) current = null;
    try { entry.cleanup?.(); } catch {}
    for (const v of entry.overlay?.querySelectorAll('video, audio') ?? []) {
      v.pause(); v.removeAttribute('src'); v.load();
    }
    for (const img of entry.overlay?.querySelectorAll('img') ?? []) img.removeAttribute('src');
    entry.overlay?.replaceChildren(); entry.overlay?.remove();
    if (entry.url) URL.revokeObjectURL(entry.url);
  });
  return entry;
}
const usable = (entry) => current === entry && entry.scope.valid();
async function loadBytes(load, entry) {
  try {
    if (!usable(entry)) { entry.scope.cancel(); return null; }
    const bytes = await load({ signal: entry.scope.signal });
    if (!usable(entry)) { bytes.fill(0); return null; }
    return bytes;
  } catch (e) { if (usable(entry)) { entry.scope.cancel(); throw e; } return null; }
}
function show(bytes, mime, entry, once = false) {
  if (!usable(entry)) { bytes.fill(0); return; }
  entry.url = URL.createObjectURL(new Blob([bytes], { type: mime })); bytes.fill(0);
  const media = /^video\//.test(mime)
    ? h('video', { src: entry.url, playsinline: true, autoplay: true, disablepictureinpicture: true, disableremoteplayback: true,
      controls: true, controlslist: 'nodownload noremoteplayback', preload: 'auto', 'aria-label': once ? 'Vídeo de visualização única' : 'Vídeo' })
    : h('img', { src: entry.url, alt: once ? 'Foto de visualização única' : 'Foto', draggable: 'false' });
  entry.overlay = h('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true', oncontextmenu: (e) => e.preventDefault() }, media,
    h('button', { class: 'viewer-close', 'aria-label': 'Fechar', text: '×', onclick: closeMedia }));
  document.body.append(entry.overlay);
}
export async function openPhoto(load, mime, options) {
  const entry = begin(options); const bytes = await loadBytes(load, entry);
  if (bytes) show(bytes, mime, entry);
}
export const openMedia = openPhoto;
export function onceButton(label, load, mime, onConsumed, options) {
  let pending = false;
  const btn = h('button', { class: 'once-open open media-tag', text: label, oncontextmenu: (e) => e.preventDefault(), onclick: async (event) => {
    event.stopPropagation();
    if (pending || btn.disabled) return;
    pending = true; btn.disabled = true; btn.textContent = 'Abrindo…';
    const entry = begin(options);
    try {
      const bytes = await loadBytes(load, entry);
      if (bytes) show(bytes, mime, entry, true);
      onConsumed?.(null);
    } catch (err) { onConsumed?.(err); }
    // Não repetir automaticamente uma tentativa de consumo incerta.
  } });
  return btn;
}
export async function playAudio(load, mime, host, options) {
  const entry = begin(options); const bytes = await loadBytes(load, entry);
  if (!bytes) return;
  entry.url = URL.createObjectURL(new Blob([bytes], { type: mime })); bytes.fill(0);
  const el = h('audio', { src: entry.url, controls: true, controlslist: 'nodownload noplaybackrate noremoteplayback', disableremoteplayback: true, preload: 'auto' });
  const speeds = [1, 1.5, 2].map((r) => h('button', { class: 'secondary small', text: `${r.toLocaleString('pt-BR')}×`, onclick: () => { el.playbackRate = r; } }));
  entry.overlay = h('div', { class: 'audio-box' }, el, h('div', { class: 'row' }, speeds,
    h('button', { class: 'secondary small', text: 'Fechar', onclick: (e) => { e.stopPropagation(); closeMedia(); } })));
  host.append(entry.overlay); el.play().catch(() => {});
}
export async function openDoc(load, name, mime, options) {
  return mime === 'application/pdf' ? openPdf(load, name, options) : openText(load, name, options);
}
export async function openText(load, name, options) {
  const entry = begin(options); const bytes = await loadBytes(load, entry);
  if (!bytes) return;
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch (e) { entry.scope.cancel(); throw e; } finally { bytes.fill(0); }
  if (!usable(entry)) return;
  entry.overlay = h('div', { class: 'viewer doc', role: 'dialog', 'aria-modal': 'true', 'aria-label': name || 'Documento', oncontextmenu: (e) => e.preventDefault(), oncopy: (e) => e.preventDefault() },
    h('div', { class: 'doc-head' }, h('span', { text: name || 'Documento' })), h('pre', { class: 'doc-text', text }),
    h('button', { class: 'viewer-close', 'aria-label': 'Fechar', text: '×', onclick: closeMedia }));
  document.body.append(entry.overlay);
}
export const isPdf = (b) => b.length > 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d;
const MAX_PAGES = 300;
let pdfLib;
export async function openPdf(load, name, options) {
  const entry = begin(options); const bytes = await loadBytes(load, entry);
  if (!bytes) return;
  entry.cleanup = () => bytes.fill(0);
  if (!isPdf(bytes)) { entry.scope.cancel(); throw new Error('o arquivo não é um PDF'); }
  try {
    pdfLib ??= await import('../vendor/pdfjs/pdf.min.mjs');
    if (!usable(entry)) { bytes.fill(0); return; }
    const { getDocument, GlobalWorkerOptions, AnnotationMode } = pdfLib;
    const worker = new Worker(scriptURL(new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href), { type: 'module' });
    GlobalWorkerOptions.workerPort = worker;
    const pages = h('div', { class: 'pdf-pages' });
    const status = h('p', { class: 'muted small pdf-status', role: 'status', text: 'Abrindo…' });
    entry.overlay = h('div', { class: 'viewer doc pdf', role: 'dialog', 'aria-modal': 'true', 'aria-label': name || 'PDF', oncontextmenu: (e) => e.preventDefault() },
      h('div', { class: 'doc-head' }, h('span', { text: name || 'PDF' })), h('div', { class: 'pdf-scroll' }, status, pages),
      h('button', { class: 'viewer-close', 'aria-label': 'Fechar', text: '×', onclick: closeMedia }));
    document.body.append(entry.overlay);
    let task;
    entry.cleanup = () => {
      for (const c of pages.querySelectorAll('canvas')) { c.width = 0; c.height = 0; }
      task?.destroy().catch(() => {}).finally(() => worker.terminate());
      if (!task) worker.terminate();
      if (bytes.byteLength) bytes.fill(0);
    };
    task = getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, enableXfa: false,
      disableAutoFetch: true, disableStream: true, disableRange: true, useWorkerFetch: false, maxImageSize: 40_000_000, stopAtErrors: false, verbosity: 0 });
    const doc = await task.promise;
    if (!usable(entry)) return;
    const n = Math.min(doc.numPages, MAX_PAGES);
    status.textContent = doc.numPages > MAX_PAGES ? `Mostrando as primeiras ${MAX_PAGES} de ${doc.numPages} páginas.` : `${n} página${n > 1 ? 's' : ''}`;
    const width = Math.min(entry.overlay.clientWidth || 360, 1200) - 16, dpr = Math.min(devicePixelRatio || 1, 2);
    for (let i = 1; i <= n && usable(entry); i++) {
      const page = await doc.getPage(i);
      if (!usable(entry)) { page.cleanup(); break; }
      const viewport = page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * dpr });
      const canvas = h('canvas', { class: 'pdf-page', 'aria-label': `Página ${i}` });
      canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height); canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
      pages.append(canvas);
      await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport, annotationMode: AnnotationMode.DISABLE }).promise;
      page.cleanup();
    }
  } catch (e) { if (!usable(entry)) return; entry.scope.cancel(); throw e; }
}
if (globalThis.addEventListener) addEventListener('keydown', (e) => { if (e.key === 'Escape' && current) { e.preventDefault(); closeMedia(); } });
