// Construção de interface sem HTML em texto: só createElement e textContent.
// Mensagens nunca viram HTML (SECURITY.md) e isto funciona com Trusted Types.
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

export function header(title, { back, actions = [] } = {}) {
  return h('header', { class: 'bar' },
    back ? h('button', { class: 'icon', 'aria-label': 'Voltar', onclick: back, text: '‹' }) : h('span', { class: 'spacer' }),
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
        h('button', { class: 'block', text: 'Fechar', onclick: () => close(null) })));
    document.body.append(sheet);
  });
}

// Erro do servidor em palavras de gente.
export function errText(e) {
  if (e?.code === 'storage_full') return 'o espaço do servidor está cheio agora. Tente de novo mais tarde ou apague mídias antigas.';
  if (e?.code === 'rate_limited') return 'muitas ações seguidas. Espere um minuto e tente de novo.';
  return e?.message ?? String(e);
}
