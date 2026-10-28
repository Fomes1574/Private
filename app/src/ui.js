// Construção de interface sem HTML em texto: só createElement e textContent.
// Mensagens nunca viram HTML (SECURITY.md) e isto funciona com Trusted Types.
import { icon } from './icons.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function mount(node) {
  const root = document.getElementById('root');
  node.classList?.add('screen-in'); // entrada curta (some com "reduzir movimento")
  root.replaceChildren(node);
  window.scrollTo(0, 0);
}

let toastTimer;
export function toast(text) {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

// Ao trancar ou apagar: nada do que estava na tela fica (aviso, folha,
// visualizador, editor, câmera). No PIN de coação, nem a palavra "coação"
// de um aviso anterior pode aparecer.
export function clearOverlays() {
  clearTimeout(toastTimer);
  const t = document.getElementById('toast');
  if (t) { t.textContent = ''; t.hidden = true; }
  for (const el of document.querySelectorAll('.sheet, .viewer, .editor, .camera')) el.remove();
}

// Botão só com ícone: o nome vai para o leitor de tela (aria-label).
export const iconButton = (name, label, onclick, extra = {}) => h('button', { class: 'icon', 'aria-label': label, title: label, onclick, ...extra }, icon(name, 22));

// Cabeçalho. `large`: título grande à esquerda (lista de conversas).
export function header(title, { back, actions = [], large = false } = {}) {
  return h('header', { class: large ? 'bar large' : 'bar' },
    back ? iconButton('back', 'Voltar', back) : large ? null : h('span', { class: 'spacer' }),
    h('h1', { text: title }),
    h('div', { class: 'actions' }, actions));
}

// Confirmação dentro da página (confirm() não aparece em todo lugar).
export function confirmSheet(question, okLabel = 'Confirmar') {
  return new Promise((resolve) => {
    const close = (v) => { sheet.remove(); resolve(v); };
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'sheet-box' },
        h('p', { text: question }),
        h('div', { class: 'row' },
          h('button', { class: 'secondary', text: 'Cancelar', onclick: () => close(false) }),
          h('button', { class: 'danger', text: okLabel, onclick: () => close(true) }))));
    document.body.append(sheet);
  });
}

export function choiceSheet(title, options) {
  return new Promise((resolve) => {
    const close = (v) => { sheet.remove(); resolve(v); };
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', onclick: (e) => { if (e.target === sheet) close(null); } },
      h('div', { class: 'sheet-box' },
        h('p', { class: 'muted', text: title }),
        options.map((o) => h('button', { class: o.danger ? 'danger block' : 'secondary block', text: o.label, onclick: () => close(o.value) })),
        h('button', { class: 'block ghost', text: 'Fechar', onclick: () => close(null) })));
    document.body.append(sheet);
  });
}

// Folha de anexar: botões grandes com ícone e uma palavra (D12).
export function iconSheet(label, options) {
  return new Promise((resolve) => {
    const close = (v) => { sheet.remove(); resolve(v); };
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': label, onclick: (e) => { if (e.target === sheet) close(null); } },
      h('div', { class: 'sheet-box' },
        h('span', { class: 'grip', 'aria-hidden': 'true' }),
        h('div', { class: 'icon-grid' }, options.map((o) => h('button', { class: `icon-choice tone-${o.icon}`, onclick: () => close(o.value) }, h('span', { class: 'icon-tile' }, icon(o.icon, 28)), h('span', { text: o.label })))),
        h('button', { class: 'block ghost', text: 'Fechar', onclick: () => close(null) })));
    document.body.append(sheet);
  });
}

// Erro do servidor em palavras de gente.
export function errText(e) {
  if (e?.code === 'storage_full') return 'o espaço do servidor está cheio agora. Tente de novo mais tarde ou apague mídias antigas.';
  if (e?.code === 'rate_limited') return 'muitas ações seguidas. Espere um minuto e tente de novo.';
  return e?.message ?? String(e);
}

// Segurar (toque longo) como no WhatsApp; no computador, botão direito.
// Devolve true no clique que vier logo depois do toque longo, para quem
// chama ignorar esse clique.
export function onLongPress(el, fn, ms = 450) {
  let timer = null, x = 0, y = 0, fired = false;
  const stop = () => { clearTimeout(timer); timer = null; };
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    fired = false; x = e.clientX; y = e.clientY;
    stop(); timer = setTimeout(() => { timer = null; fired = true; fn(e); }, ms);
  });
  el.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - x, e.clientY - y) > 10) stop(); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, stop);
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); stop(); fired = true; fn(e); });
  el.addEventListener('click', (e) => { if (fired) { fired = false; e.stopPropagation(); e.preventDefault(); } }, true);
}
