// Preparar de 1 a 5 fotos antes de enviar (D4), como no WhatsApp: foto
// grande, faixa de miniaturas numeradas, edição e "ver uma vez" por foto,
// legenda por foto, remover, reordenar e adicionar até 5. Nada sobe antes de
// tocar em "Enviar". Tudo fica só na memória e é zerado ao sair.
import { h, toast, confirmSheet } from '../ui.js';
import { editPhoto } from '../editor.js';
import { openCamera } from '../camera.js';
import { preparePhoto } from '../media.js';
import { sensitiveScope } from '../sensitive-scope.js';

export const MAX_BATCH = 5;

// items: [{ bytes, mime }] já recodificados (sem metadados).
// Devolve [{ bytes, mime, once, caption }] na ordem escolhida, ou null.
export function prepareBatch(items, { allowGallery = false, initialCaption = '' } = {}) {
  return new Promise((resolve) => {
    const scope = sensitiveScope();
    const photos = items.slice(0, MAX_BATCH).map((it, i) => ({ id: crypto.randomUUID(), bytes: it.bytes, original: it.bytes, mime: it.mime, once: false, hd: false, caption: i === 0 ? initialCaption : '', url: null }));
    if (items.length > MAX_BATCH) { for (const it of items.slice(MAX_BATCH)) it.bytes.fill(0); toast(`Dá para mandar até ${MAX_BATCH} fotos de uma vez. As outras ficaram de fora.`); }
    let sel = 0, done = false, busy = false;
    const alive = () => !done && scope.valid();
    const working = (on) => { busy = on; for (const b of overlay.querySelectorAll('button')) if (b.textContent !== 'Cancelar') b.disabled = on; };
    const urlOf = (p) => (p.url ??= URL.createObjectURL(new Blob([p.bytes], { type: p.mime })));
    const dropUrl = (p) => { if (p.url) { URL.revokeObjectURL(p.url); p.url = null; } };
    const main = h('img', { class: 'batch-main', alt: 'Foto selecionada', draggable: 'false' });
    const strip = h('div', { class: 'batch-strip row', role: 'listbox', 'aria-label': 'Fotos selecionadas' });
    const count = h('span', { class: 'muted small' });
    const caption = h('input', { id: 'batch-caption', maxlength: '1000', autocomplete: 'off', placeholder: 'Legenda desta foto' });
    const onceBtn = h('button', { class: 'once-toggle', type: 'button', 'aria-pressed': 'false', 'aria-label': 'Ver uma vez desligado', text: '1' });
    const hdBtn = h('button', { class: 'secondary small', text: 'HD', 'aria-pressed': 'false', onclick: () => { if (!busy) { photos[sel].hd = !photos[sel].hd; draw(); } } });
    const sendBtn = h('button', { class: 'send-batch' });
    const fileIn = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
    const overlay = h('div', { class: 'editor batch', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Preparar fotos' },
      h('div', { class: 'row' }, h('button', { class: 'secondary small', text: 'Cancelar', onclick: () => finish(null) }), count),
      main, strip,
      h('div', { class: 'row wrap' },
        h('button', { class: 'secondary small', text: 'Editar', onclick: edit }),
        h('button', { class: 'secondary small', text: 'Desfazer edição', onclick: undo }),
        h('button', { class: 'secondary small', 'aria-label': 'Mover para a esquerda', text: '◀', onclick: () => move(-1) }),
        h('button', { class: 'secondary small', 'aria-label': 'Mover para a direita', text: '▶', onclick: () => move(1) }),
        h('button', { class: 'danger small', text: 'Remover', onclick: remove })),
      // Como no WhatsApp: HD e ① ficam colados na legenda.
      h('div', { class: 'row caption-row' }, caption, hdBtn, onceBtn),
      h('div', { class: 'row wrap' },
        h('button', { class: 'secondary small', text: '+ Câmera', onclick: addCamera }),
        allowGallery ? h('button', { class: 'secondary small', text: '+ Galeria', onclick: () => fileIn.click() }) : null,
        sendBtn),
      fileIn);

    function draw() {
      if (!alive()) return;
      if (!photos.length) return finish(null);
      sel = Math.min(sel, photos.length - 1);
      const p = photos[sel];
      main.src = urlOf(p);
      strip.replaceChildren(...photos.map((x, i) => h('button', { class: i === sel ? 'thumb on' : 'thumb', role: 'option', 'aria-selected': String(i === sel), 'aria-label': `Foto ${i + 1}${x.once ? ', ver uma vez' : ''}`, onclick: () => { saveCaption(); sel = i; draw(); } },
        h('img', { src: urlOf(x), alt: '' }), h('span', { class: 'thumb-n', text: x.once ? `${i + 1}·①` : String(i + 1) }))));
      count.textContent = `${photos.length}/${MAX_BATCH}`;
      hdBtn.setAttribute('aria-pressed', String(p.hd));
      onceBtn.setAttribute('aria-pressed', String(p.once));
      onceBtn.setAttribute('aria-label', p.once ? 'Visualização única ativada' : 'Ver uma vez desligado');
      onceBtn.classList.toggle('on', p.once);
      caption.value = p.caption; caption.disabled = p.once;
      caption.placeholder = p.once ? 'Ver uma vez não tem legenda' : 'Legenda desta foto';
      sendBtn.textContent = photos.length > 1 ? `Enviar ${photos.length} fotos` : 'Enviar foto';
    }
    function saveCaption() { const p = photos[sel]; if (p && !p.once) p.caption = caption.value.trim().slice(0, 1000); }
    onceBtn.onclick = async () => {
      if (busy || !alive()) return;
      saveCaption();
      const p = photos[sel];
      if (!p.once && p.caption && !await confirmSheet('Ver uma vez não leva legenda. Ativar e tirar a legenda desta foto?', 'Ativar')) return;
      if (!alive() || !photos.includes(p)) return;
      p.once = !p.once;
      if (p.once) { p.caption = ''; toast('Ver uma vez: no iPhone o app não consegue bloquear print nem gravação de tela.'); }
      draw();
    };
    async function edit() {
      if (busy || !alive()) return;
      const p = photos[sel];
      working(true);
      let r;
      try { r = await editPhoto(p.bytes, p.mime, { signal: scope.signal }); } finally { if (alive()) working(false); }
      if (!r) return;
      if (!alive() || !photos.includes(p)) { r.bytes.fill(0); return; }
      if (p.bytes !== p.original) p.bytes.fill(0);
      dropUrl(p); p.bytes = r.bytes; p.mime = r.mime; draw();
    }
    function undo() {
      const p = photos[sel];
      if (p.bytes === p.original) return;
      p.bytes.fill(0); dropUrl(p); p.bytes = p.original; draw();
    }
    function move(d) {
      saveCaption();
      const j = sel + d;
      if (j < 0 || j >= photos.length) return;
      [photos[sel], photos[j]] = [photos[j], photos[sel]]; sel = j; draw();
    }
    function wipe(p) { dropUrl(p); if (p.bytes !== p.original) p.bytes.fill(0); p.original.fill(0); }
    function remove() { const [p] = photos.splice(sel, 1); wipe(p); draw(); }
    function room() { if (photos.length >= MAX_BATCH) { toast(`Limite de ${MAX_BATCH} fotos por envio.`); return false; } return true; }
    async function addCamera() {
      if (busy || !alive() || !room()) return;
      saveCaption();
      working(true);
      const shot = await openCamera({ mode: 'photo', signal: scope.signal });
      if (!shot || !alive()) { shot?.bytes.fill(0); if (alive()) working(false); return; }
      try { const pr = await preparePhoto(new Blob([shot.bytes], { type: 'image/jpeg' }), { maxSide: 4096, quality: 0.9 }); add(pr); } catch (e) { toast(e.message); } finally { shot.bytes.fill(0); if (alive()) working(false); }
    }
    fileIn.onchange = async () => {
      const files = [...fileIn.files]; fileIn.value = '';
      if (!alive() || busy) return;
      working(true);
      saveCaption();
      for (const f of files) {
        if (!alive() || !room()) break;
        try { add(await preparePhoto(f, { maxSide: 4096, quality: 0.9 })); } catch (e) { toast(e.message); }
      }
      if (alive()) working(false);
    };
    function add(pr) { if (!alive() || photos.length >= MAX_BATCH) { pr.bytes.fill(0); return; } photos.push({ id: crypto.randomUUID(), bytes: pr.bytes, original: pr.bytes, mime: pr.mime, once: false, hd: false, caption: '', url: null }); sel = photos.length - 1; draw(); }
    sendBtn.onclick = () => {
      if (busy || !alive()) return;
      saveCaption();
      // A seleção congela no envio: ordem e modo não mudam mais.
      const out = photos.map((p) => { if (p.bytes !== p.original) p.original.fill(0); dropUrl(p); return { bytes: p.bytes, mime: p.mime, once: p.once, hd: p.hd, caption: p.once ? undefined : p.caption || undefined }; });
      photos.length = 0;
      finish(out);
    };
    function finish(out) {
      if (done) return;
      done = true;
      main.removeAttribute('src');
      for (const p of photos) wipe(p);
      overlay.remove();
      scope.cancel();
      resolve(out);
    }
    scope.onCancel(() => finish(null));
    document.body.append(overlay);
    draw();
  });
}
