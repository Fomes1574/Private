// Apelido (V7-006): único no círculo, anunciado cifrado; nunca é identidade.
import { h, mount, toast, header } from '../ui.js';
import * as session from '../session.js';

export function nicknameScreen(go, { back = null } = {}) {
  const input = h('input', { id: 'nick', maxlength: '24', autocomplete: 'off', value: session.myNickname() ?? '' });
  mount(h('div', {},
    header('Seu apelido', { back: back ? () => go(back) : null }),
    h('main', {},
      h('p', { class: 'muted', text: 'É assim que o círculo vai te ver. Evite seu nome real.' }),
      h('form', { onsubmit: async (e) => {
        e.preventDefault();
        const old = session.myNickname();
        try {
          await session.setNickname(input.value);
          toast(old ? `${old} alterou seu nome para ${input.value.trim()}` : 'Apelido salvo.');
          go(back ?? 'chats');
        } catch (err) { toast(err.message); }
      } }, h('label', { for: 'nick', text: 'Apelido' }), input, h('button', { class: 'block', text: 'Salvar' })))));
}
