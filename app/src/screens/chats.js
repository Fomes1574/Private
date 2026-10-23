// Lista de conversas. Sem online, visto, digitando ou contagem (V6-022).
import { h, mount, header, toast } from '../ui.js';
import * as session from '../session.js';
import { formatTime } from '../packages/protocol/src/time.js';
import { avatar } from '../avatar.js';

export async function chatsScreen(go) {
  const list = h('ul', { class: 'list', role: 'list' });
  const search = h('input', { id: 'search', type: 'search', placeholder: 'Buscar por apelido', autocomplete: 'off', 'aria-label': 'Buscar por apelido' });
  const results = h('ul', { class: 'list results' });
  search.oninput = () => {
    results.replaceChildren(...session.searchPeople(search.value).map((p) =>
      h('li', {}, h('button', { class: 'row-btn', onclick: async () => {
        try { const v = await session.startDirect(p.userId); go('chat', { roomId: v.roomId }); } catch (e) { toast(`Não deu: ${e.message}`); }
      } }, avatar(p.nickname, session.photoOf(p.userId)), h('span', { text: p.nickname })))));
  };
  mount(h('div', {},
    header('Conversas', { actions: [
      h('button', { class: 'icon', 'aria-label': 'Novo grupo', text: '+', onclick: () => go('newGroup') }),
      h('button', { class: 'icon', 'aria-label': 'Ajustes', text: '⚙', onclick: () => go('settings') }),
    ] }),
    h('main', {}, search, results, list)));

  const render = async () => {
    const views = (await session.listRooms()).filter(Boolean);
    const rows = [];
    for (const v of views) {
      const msgs = await session.S.client.view(v.roomId);
      const last = msgs.render.at(-1);
      rows.push({ v, last, at: last?.acceptedAt ?? 0 });
    }
    rows.sort((a, b) => b.at - a.at);
    list.replaceChildren(...(rows.length ? rows.map(({ v, last }) =>
      h('li', {}, h('button', { class: 'row-btn', onclick: () => go('chat', { roomId: v.roomId }) },
        avatar(session.roomTitle(v), session.roomPhoto(v)),
        h('span', { class: 'grow' },
          h('span', { class: 'title', text: session.roomTitle(v) }),
          h('span', { class: 'muted small', text: last ? (last.kind === 'media' ? 'Mídia' : 'Mensagem') : (v.closed ? 'Encerrada' : 'Sem mensagens') })),
        last ? h('time', { class: 'muted small', text: formatTime(last.acceptedAt) }) : null)))
      : [h('li', { class: 'empty', text: 'Nenhuma conversa ainda. Busque alguém pelo apelido.' })]));
  };
  await render().catch((e) => toast(`Não deu para carregar: ${e.message}`));
  return session.onChange((w) => { if (w === 'synced') render().catch(() => {}); });
}
