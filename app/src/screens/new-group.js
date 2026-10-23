// Grupo novo: quem cria é a líder; prazos separados de texto e mídia (V6-010).
import { h, mount, header, toast } from '../ui.js';
import * as session from '../session.js';
import { TTL_OPTIONS, DEFAULT_TTL, describeTtl } from '../packages/protocol/src/ttl.js';

export function ttlSelect(id, value = DEFAULT_TTL) {
  return h('select', { id }, TTL_OPTIONS.map((s) => h('option', { value: String(s), text: describeTtl(s), selected: s === value })));
}

export function newGroupScreen(go) {
  const title = h('input', { id: 'title', maxlength: '60', autocomplete: 'off' });
  const people = Object.entries(session.S.nicknames).filter(([u]) => u !== session.S.client.userId);
  const boxes = people.map(([u, n]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: u }), n.nickname));
  const text = ttlSelect('ttlText'), media = ttlSelect('ttlMedia');
  mount(h('div', {},
    header('Novo grupo', { back: () => go('chats') }),
    h('main', {}, h('form', { onsubmit: async (e) => {
      e.preventDefault();
      const members = boxes.map((b) => b.querySelector('input')).filter((i) => i.checked).map((i) => i.value);
      if (!title.value.trim()) return toast('Dê um nome ao grupo.');
      if (!members.length) return toast('Escolha pelo menos uma pessoa.');
      try {
        const v = await session.startGroup(title.value.trim(), members, { textTtl: Number(text.value), mediaTtl: Number(media.value) });
        go('chat', { roomId: v.roomId });
      } catch (err) { toast(`Não deu: ${err.message}`); }
    } },
    h('label', { for: 'title', text: 'Nome do grupo' }), title,
    h('fieldset', {}, h('legend', { text: 'Pessoas' }), boxes.length ? boxes : h('p', { class: 'muted', text: 'Ainda não há outras pessoas no círculo.' })),
    h('label', { for: 'ttlText', text: 'Mensagens somem em' }), text,
    h('label', { for: 'ttlMedia', text: 'Fotos, vídeos e áudios somem em' }), media,
    h('button', { class: 'block', text: 'Criar grupo' })))));
}
