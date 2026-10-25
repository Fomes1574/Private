// Anotações ("conversa comigo", D), como a conversa consigo mesma do
// WhatsApp, mas só neste aparelho: nada vai ao servidor, fica no banco
// cifrado e vence no prazo escolhido (passo 9).
import { h, mount, header, toast, confirmSheet } from '../ui.js';
import * as session from '../session.js';
import { TTL_OPTIONS, describeTtl, DAY } from '../packages/protocol/src/ttl.js';
import { formatDateTime } from '../packages/protocol/src/time.js';
import { formatted } from '../format.js';

export async function notesScreen(go) {
  const list = h('ol', { class: 'messages', role: 'log' });
  const input = h('textarea', { id: 'note-text', rows: '2', maxlength: '4000', placeholder: 'Anotação (só neste aparelho)', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false' });
  const ttl = h('select', { id: 'note-ttl', 'aria-label': 'Some em' }, TTL_OPTIONS.map((s) => h('option', { value: String(s), text: `Some em ${describeTtl(s)}`, selected: s === 7 * DAY })));
  const render = async () => {
    const all = await session.notes();
    list.replaceChildren(...(all.length ? all.map((n) => h('li', { class: 'msg mine' },
      h('span', { class: 'text' }, ...formatted(n.text)),
      h('span', { class: 'meta' }, h('time', { text: `some ${formatDateTime(n.expiresAt)}` }),
        h('button', { class: 'secondary small', text: 'Apagar', onclick: async () => { if (await confirmSheet('Apagar esta anotação?', 'Apagar')) { await session.deleteNote(n.id); render(); } } }))))
      : [h('li', { class: 'note', text: 'Nenhuma anotação. O que você escrever aqui fica só neste aparelho, cifrado, e some no prazo.' })]));
  };
  mount(h('div', { class: 'chat' },
    header('Anotações', { back: () => go('chats') }),
    list,
    h('footer', { class: 'composer' }, h('div', { class: 'row' }, ttl), h('div', { class: 'row' }, input,
      h('button', { class: 'send', 'aria-label': 'Salvar anotação', text: '➤', onclick: async () => {
        const t = input.value.trim();
        if (!t) return;
        await session.addNote(t, Number(ttl.value));
        input.value = '';
        toast('Anotação salva só neste aparelho.');
        render();
      } })))));
  await render();
}
