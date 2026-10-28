// Editor de foto (V6-025): girar, recortar, desenhar, apagar e escrever, tudo
// no aparelho. Entra a foto já recodificada (sem metadados) e sai um JPEG novo.
// Nada sobreposto automaticamente: só o que a própria pessoa desenhar.
import { h } from './ui.js';
import { icon } from './icons.js';
import { sensitiveScope } from './sensitive-scope.js';

const COLORS = ['#FFFFFF', '#000000', '#FF5A5A', '#FFD23F', '#3DDC97', '#6CB4FF'];
const CROPS = [['Original', null], ['Quadrado', 1], ['4:5', 4 / 5], ['16:9', 16 / 9]];

export function editPhoto(bytes, mime = 'image/jpeg', { signal } = {}) {
  return new Promise(async (resolve, reject) => {
    const scope = sensitiveScope({ signal });
    let src;
    try { src = await createImageBitmap(new Blob([bytes], { type: mime })); }
    catch (e) { scope.finish(); reject(e); return; }
    if (!scope.valid()) { src.close(); scope.finish(); resolve(null); return; }
    let rot = 0, crop = null, color = COLORS[2], mode = 'draw';
    let marks = []; // traços e textos, em coordenadas da imagem original
    const canvas = h('canvas', { class: 'editor-canvas', 'aria-label': 'Foto em edição' });
    const g = canvas.getContext('2d');
    // Camada só das marcas: a borracha apaga desenho e texto, nunca a foto.
    const layer = document.createElement('canvas');
    const lg = layer.getContext('2d');

    // Geometria atual: imagem girada e recortada no centro.
    function geometry() {
      const rw = rot % 2 ? src.height : src.width, rh = rot % 2 ? src.width : src.height;
      let cw = rw, ch = rh;
      if (crop) { if (rw / rh > crop) cw = Math.round(rh * crop); else ch = Math.round(rw / crop); }
      return { rw, rh, cw, ch, ox: (rw - cw) / 2, oy: (rh - ch) / 2 };
    }
    function place(ctx, { rw, rh, ox, oy }) {
      ctx.translate(-ox, -oy);
      ctx.translate(rw / 2, rh / 2);
      ctx.rotate((rot * Math.PI) / 2);
      ctx.translate(-src.width / 2, -src.height / 2);
    }
    function draw() {
      const geo = geometry();
      canvas.width = layer.width = geo.cw; canvas.height = layer.height = geo.ch;
      g.save(); place(g, geo); g.drawImage(src, 0, 0); g.restore();
      lg.save(); place(lg, geo);
      for (const m of marks) {
        lg.globalCompositeOperation = m.kind === 'erase' ? 'destination-out' : 'source-over';
        if (m.kind === 'stroke' || m.kind === 'erase') {
          lg.strokeStyle = m.kind === 'erase' ? '#000' : m.color; lg.lineWidth = m.width; lg.lineCap = 'round'; lg.lineJoin = 'round';
          lg.beginPath();
          m.points.forEach(([x, y], i) => (i ? lg.lineTo(x, y) : lg.moveTo(x, y)));
          // Um toque só (sem arrastar) também marca ou apaga um ponto.
          if (m.points.length === 1) lg.lineTo(m.points[0][0] + 0.01, m.points[0][1]);
          lg.stroke();
        } else {
          lg.font = `700 ${m.size}px -apple-system, system-ui, sans-serif`;
          lg.textAlign = 'center'; lg.textBaseline = 'middle';
          lg.lineWidth = Math.max(2, m.size / 8); lg.strokeStyle = m.color === '#000000' ? '#FFFFFF' : '#000000';
          lg.strokeText(m.text, m.x, m.y); lg.fillStyle = m.color; lg.fillText(m.text, m.x, m.y);
        }
      }
      lg.restore();
      g.drawImage(layer, 0, 0);
    }
    const toImage = (e) => {
      const r = canvas.getBoundingClientRect();
      const { rw, rh, ox, oy } = geometry();
      const x = ((e.clientX - r.left) / r.width) * canvas.width + ox - rw / 2;
      const y = ((e.clientY - r.top) / r.height) * canvas.height + oy - rh / 2;
      const c = [1, 0, -1, 0][rot], s = [0, 1, 0, -1][rot];
      return [c * x + s * y + src.width / 2, -s * x + c * y + src.height / 2];
    };
    let stroke = null;
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (mode === 'text') return placeText(toImage(e));
      canvas.setPointerCapture?.(e.pointerId);
      stroke = mode === 'erase'
        ? { kind: 'erase', width: Math.max(16, src.width / 30), points: [toImage(e)] }
        : { kind: 'stroke', color, width: Math.max(4, src.width / 120), points: [toImage(e)] };
      marks.push(stroke);
    });
    canvas.addEventListener('pointermove', (e) => { if (stroke) { stroke.points.push(toImage(e)); draw(); } });
    for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, () => { stroke = null; draw(); });

    const textIn = h('input', { id: 'editor-text', maxlength: '80', placeholder: 'Escreva e toque na foto', autocomplete: 'off', hidden: true, 'aria-label': 'Texto para a foto' });
    function placeText([x, y]) {
      const t = textIn.value.trim();
      if (!t) return;
      marks.push({ kind: 'text', text: t, color, x, y, size: Math.max(18, Math.round(src.width / 14)) });
      textIn.value = '';
      draw();
    }
    // Marcas no espaço da imagem original: giram junto e sobrevivem ao recorte.
    const reshape = (fn) => { fn(); draw(); };
    const tool = (label, fn, extra = {}) => h('button', { type: 'button', class: 'secondary small', text: label, onclick: fn, ...extra });
    const modeBtn = (m, label, ico) => h('button', { type: 'button', class: 'secondary small tool', 'aria-label': label, title: label, 'aria-pressed': String(m === mode), onclick: () => setMode(m) }, ico ? icon(ico, 20) : label);
    const modeBtns = { draw: modeBtn('draw', 'Desenhar', 'pen'), erase: modeBtn('erase', 'Borracha', 'eraser'), text: modeBtn('text', 'Escrever', null) };
    function setMode(m) {
      mode = m;
      for (const [k, b] of Object.entries(modeBtns)) b.setAttribute('aria-pressed', String(k === m));
      textIn.hidden = m !== 'text';
      if (m === 'text') textIn.focus();
    }
    const swatches = COLORS.map((c) => {
      const b = h('button', { type: 'button', class: 'swatch', 'aria-label': `Cor ${c}`, onclick: () => { color = c; swatches.forEach((s) => s.classList.toggle('on', s === b)); } });
      b.style.background = c; // CSSOM: permitido pela CSP (sem estilo em linha)
      if (c === color) b.classList.add('on');
      return b;
    });
    let finished = false;
    const done = (out) => { if (finished) { out?.bytes?.fill(0); return; } finished = true; overlay.replaceChildren(); overlay.remove(); canvas.width = 0; canvas.height = 0; layer.width = layer.height = 0; marks = []; textIn.value = ''; src.close(); scope.finish(); resolve(out); };
    const overlay = h('div', { class: 'editor', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Editar foto' },
      h('div', { class: 'editor-bar row' },
        tool('Cancelar', () => done(null)),
        tool('Girar', () => reshape(() => { rot = (rot + 1) % 4; })),
        ...CROPS.map(([label, r]) => tool(label, () => reshape(() => { crop = r; }))),
        h('button', { type: 'button', class: 'secondary small tool', 'aria-label': 'Desfazer', title: 'Desfazer', onclick: () => { marks.pop(); draw(); } }, icon('undo', 20))),
      h('div', { class: 'editor-stage' }, canvas),
      h('div', { class: 'editor-bar row' }, ...Object.values(modeBtns), ...swatches),
      textIn,
      h('div', { class: 'editor-bar row' },
        h('button', { type: 'button', class: 'block', text: 'Usar foto', onclick: async () => {
          const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
          if (!blob) { done(null); return; }
          const out = new Uint8Array(await blob.arrayBuffer());
          if (!scope.valid()) { out.fill(0); done(null); return; }
          g.clearRect(0, 0, canvas.width, canvas.height);
          done({ bytes: out, mime: 'image/jpeg', width: canvas.width, height: canvas.height });
        } })));
    scope.onCancel(() => done(null));
    if (!scope.valid()) { done(null); return; }
    document.body.append(overlay);
    draw();
  });
}
