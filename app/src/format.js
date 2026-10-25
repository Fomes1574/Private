// Formatação como no WhatsApp (b.9): *negrito*, _itálico_, ~tachado~,
// ```mono```, `código`, "> " citação e "- "/"* "/"1. " listas, e @menção
// (b.10). Monta só nós de texto e elementos fixos: nunca HTML vindo da
// mensagem, nunca link clicável (passos 22 e 36).
import { h } from './ui.js';

const INLINE = [
  { re: /```([^`]+?)```/, tag: 'code', cls: 'fmt-mono' },
  { re: /`([^`\n]+?)`/, tag: 'code', cls: 'fmt-code' },
  { re: /(^|[\s(])\*(\S(?:[^*\n]*\S)?)\*(?=$|[\s.,!?;:)])/, tag: 'strong' },
  { re: /(^|[\s(])_(\S(?:[^_\n]*\S)?)_(?=$|[\s.,!?;:)])/, tag: 'em' },
  { re: /(^|[\s(])~(\S(?:[^~\n]*\S)?)~(?=$|[\s.,!?;:)])/, tag: 's' },
];

// mentions: lista de apelidos conhecidos (para destacar @Apelido).
function inline(text, mentions) {
  let best = null;
  for (const f of INLINE) {
    const m = f.re.exec(text);
    if (m && (!best || m.index < best.m.index)) best = { f, m };
  }
  if (!best) return mentionNodes(text, mentions);
  const { f, m } = best;
  const lead = m.length === 3 ? m[1] : '';
  const inner = m.length === 3 ? m[2] : m[1];
  const start = m.index + lead.length;
  const before = text.slice(0, start), after = text.slice(m.index + m[0].length);
  const el = h(f.tag, f.cls ? { class: f.cls } : {});
  el.append(...(f.tag === 'code' ? [document.createTextNode(inner)] : inline(inner, mentions)));
  return [...mentionNodes(before, mentions), el, ...inline(after, mentions)];
}

function mentionNodes(text, mentions) {
  if (!mentions?.length || !text.includes('@')) return text ? [document.createTextNode(text)] : [];
  const names = [...mentions].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`@(${names.join('|')})(?![\\p{L}\\p{N}_])`, 'u');
  const m = re.exec(text);
  if (!m) return [document.createTextNode(text)];
  return [document.createTextNode(text.slice(0, m.index)), h('span', { class: 'mention', text: m[0] }), ...mentionNodes(text.slice(m.index + m[0].length), mentions)];
}

// Texto formatado (DOM). Linha a linha, para citação e listas.
export function formatted(text, { mentions = [] } = {}) {
  const out = [];
  const lines = String(text ?? '').split('\n');
  lines.forEach((line, i) => {
    let m;
    if ((m = /^>\s?(.*)$/.exec(line))) out.push(h('span', { class: 'fmt-quote' }, ...inline(m[1], mentions)));
    else if ((m = /^([-*]|\d{1,3}\.)\s+(.*)$/.exec(line))) out.push(h('span', { class: 'fmt-li' }, `${/\d/.test(m[1]) ? m[1] : '•'} `, ...inline(m[2], mentions)));
    else out.push(...inline(line, mentions));
    if (i < lines.length - 1 && !(out.at(-1)?.classList?.contains('fmt-quote') || out.at(-1)?.classList?.contains('fmt-li'))) out.push(document.createTextNode('\n'));
  });
  return out;
}
