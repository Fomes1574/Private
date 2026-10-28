// Enquete (D), como no WhatsApp: pergunta, de 2 a 12 opções, uma ou várias
// respostas. Votos cifrados, só para quem está no grupo; quem votou em quê
// aparece para o grupo (como no WhatsApp), nunca para o servidor.
import { h, toast } from '../ui.js';
import * as session from '../session.js';

export function pollSheet() {
  return new Promise((resolve) => {
    const q = h('input', { id: 'poll-q', maxlength: '255', autocomplete: 'off', placeholder: 'Pergunta' });
    const opts = h('div', { class: 'poll-opts' });
    const addOpt = () => { if (opts.children.length >= 12) return; opts.append(h('input', { class: 'poll-opt', maxlength: '100', autocomplete: 'off', placeholder: `Opção ${opts.children.length + 1}` })); };
    addOpt(); addOpt();
    const multi = h('input', { id: 'poll-multi', type: 'checkbox' });
    const close = (v) => { sheet.remove(); resolve(v); };
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Criar enquete' }, h('form', { class: 'sheet-box', onsubmit: (e) => {
      e.preventDefault();
      const options = [...opts.querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean);
      if (!q.value.trim()) return toast('Escreva a pergunta.');
      if (options.length < 2) return toast('Pelo menos 2 opções.');
      close({ question: q.value.trim(), options, multi: multi.checked });
    } },
      h('h2', { text: 'Enquete' }), q, opts,
      h('button', { type: 'button', class: 'secondary small', text: '+ opção', onclick: addOpt }),
      h('label', { class: 'check' }, multi, 'Permitir várias respostas'),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'secondary', text: 'Cancelar', onclick: () => close(null) }), h('button', { text: 'Enviar enquete' }))));
    document.body.append(sheet);
    q.focus();
  });
}

// Mostra a enquete com contagem por opção. Tocar numa opção vota (ou troca).
export function pollBlock(m, { onVote, me }) {
  const votes = m.votes ?? {};
  const mine = new Set(votes[me] ?? []);
  const counts = m.body.options.map((_, i) => Object.values(votes).filter((c) => c.includes(i)).length);
  const total = Object.values(votes).filter((c) => c.length).length;
  return h('div', { class: 'poll' },
    h('strong', { text: m.body.question }),
    h('span', { class: 'muted small', text: m.body.multi ? 'Escolha uma ou mais' : 'Escolha uma' }),
    m.body.options.map((o, i) => h('button', { class: mine.has(i) ? 'poll-option on' : 'poll-option', type: 'button', 'aria-pressed': String(mine.has(i)), onclick: (e) => {
      e.stopPropagation();
      const next = new Set(mine);
      if (m.body.multi) { if (next.has(i)) next.delete(i); else next.add(i); } else if (next.has(i)) next.clear(); else { next.clear(); next.add(i); }
      onVote([...next].sort((a, b) => a - b));
    } }, h('span', { class: 'grow', text: o }), h('span', { class: 'small', text: String(counts[i]) }))),
    h('button', { class: 'secondary small', type: 'button', text: `Ver votos (${total})`, onclick: (e) => {
      e.stopPropagation();
      const lines = m.body.options.map((o, i) => `${o}: ${Object.entries(votes).filter(([, c]) => c.includes(i)).map(([u]) => session.nameOf(u)).join(', ') || '—'}`);
      const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'sheet-box' }, h('h2', { text: m.body.question }), lines.map((l) => h('p', { text: l })), h('button', { class: 'block', text: 'Fechar', onclick: () => sheet.remove() })));
      document.body.append(sheet);
    } }));
}
