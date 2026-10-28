// Lista de conversas, como no WhatsApp: a que recebe mensagem sobe, prévia
// da última mensagem, contador de não lidas, fixar (até 3), arquivar,
// marcar como não lida e excluir. Tudo só neste aparelho; nada de online,
// visto ou digitando (V6-022).
import { h, mount, header, iconButton, toast, choiceSheet, confirmSheet, onLongPress, errText } from '../ui.js';
import { icon } from '../icons.js';
import * as session from '../session.js';
import { searchByText } from '../packages/protocol/src/search.js';
import { pendingAttachment, takeAttachment, discardAttachment } from '../attachment-picker.js';
import { verifySheet } from './verify.js';
import { avatar } from '../avatar.js';
import { listTime } from '../dates.js';

export async function chatsScreen(go) {
  const S = session.S;
  const list = h('ul', { class: 'list', role: 'list' });
  const search = h('input', { id: 'search', type: 'search', placeholder: 'Buscar pessoa ou grupo', autocomplete: 'off', 'aria-label': 'Buscar pessoa ou grupo' });
  const results = h('ul', { class: 'list results' });
  let showArchived = false, rows = [];
  const archToggle = h('button', { class: 'secondary small', hidden: true, onclick: () => { showArchived = !showArchived; draw(); } });
  // D1: qualquer trecho do nome, pessoas e grupos, só no aparelho.
  let searchSeq = 0;
  search.oninput = async () => {
    const term = search.value, seq = ++searchSeq;
    const people = session.searchPeople(term).map((p) => ({ label: p.nickname, person: p }));
    const groups = rows.filter((r) => r.v.kind === 'group' && !r.hidden).map((r) => ({ label: session.roomTitle(r.v), room: r.v }));
    const found = term.trim() ? [...people, ...searchByText(groups, term)] : [];
    results.replaceChildren(...found.map((f) => h('li', {}, f.person
      ? h('button', { class: 'row-btn', onclick: async () => {
        try { const v = await session.startDirect(f.person.userId); go('chat', { roomId: v.roomId }); } catch (e) { toast(`Não deu: ${e.message}`); }
      } }, avatar(f.person.nickname, session.photoOf(f.person.userId)), h('span', { text: f.person.nickname }))
      : h('button', { class: 'row-btn', onclick: () => go('chat', { roomId: f.room.roomId }) }, avatar(f.label, session.roomPhoto(f.room)), h('span', { text: `${f.label} · grupo` })))));
    // b.14: mensagens de todas as conversas, só no aparelho.
    const msgs = await session.searchMessages(term);
    if (seq !== searchSeq || !msgs.length) return;
    const title = (id) => { const r = rows.find((x) => x.v.roomId === id); return r ? session.roomTitle(r.v) : 'Conversa'; };
    results.append(h('li', { class: 'muted small', text: 'Mensagens' }), ...msgs.map((x) => h('li', {}, h('button', { class: 'row-btn', onclick: () => go('chat', { roomId: x.roomId, find: term }) },
      h('span', { class: 'grow' }, h('span', { class: 'title', text: title(x.roomId) }), h('span', { class: 'muted small preview', text: x.text.slice(0, 80) }))))));
  };
  const selected = pendingAttachment();
  const attachmentCard = selected ? h('div', { class: 'card' },
    h('p', { text: 'Uma foto ou arquivo está esperando.' }),
    h('button', { text: 'Continuar com o anexo', onclick: () => { const attachment = takeAttachment(); if (attachment) go(attachment.pick.target === 'settings' ? 'settings' : attachment.pick.target === 'stories' ? 'stories' : 'chat', { roomId: attachment.roomId, attachment }); } }),
    h('button', { class: 'secondary', text: 'Descartar anexo', onclick: () => { discardAttachment(); attachmentCard.remove(); } })) : null;
  // S3: a administradora vê quem ainda espera confirmação no círculo.
  const adminCard = h('div', { hidden: true });
  async function drawApproval() {
    const yes = await session.isCircleAdmin();
    const n = yes ? session.circlePendingCount() : 0;
    adminCard.hidden = !n && (yes || !!S.client.circleRoster());
    adminCard.className = 'card';
    adminCard.replaceChildren(...(yes && n ? [h('p', { text: `${n} ${n > 1 ? 'pessoas aguardam' : 'pessoa aguarda'} sua confirmação no círculo.` }), h('button', { class: 'secondary', text: 'Conferir em Ajustes', onclick: () => go('settings') })] : !yes && !S.client.circleRoster() ? [h('p', { text: 'Falta a administradora confirmar sua entrada. Até lá, perfis e stories ficam fechados.' }), h('button', { class: 'secondary', text: 'Verificar administradora', onclick: async () => { const id = await S.client.circleAdminId(); if (id) await verifySheet(id); } })] : []));
  }

  mount(h('div', {},
    header('Conversas', { actions: [
      iconButton('note', 'Anotações', () => go('notes')),
      iconButton('stories', 'Stories', () => go('stories')),
      iconButton('group', 'Novo grupo', () => go('newGroup')),
      iconButton('settings', 'Ajustes', () => go('settings')),
    ], large: true }),
    h('main', {}, attachmentCard, adminCard, search, results, archToggle, list)));

  const flag = (v, k) => !!S.rooms[v.roomId]?.[k];
  async function rowMenu(v) {
    const unread = session.unreadCount(v.roomId, (rows.find((r) => r.v === v)?.render) ?? []) > 0;
    const left = !session.imActive(v);
    const opts = [
      { label: flag(v, 'pinned') ? 'Desafixar' : 'Fixar no topo', value: 'pin' },
      { label: flag(v, 'archived') ? 'Desarquivar' : 'Arquivar', value: 'archive' },
      { label: unread ? 'Marcar como lida' : 'Marcar como não lida', value: 'unread' },
    ];
    if (v.kind === 'direct' || left || v.closed) opts.push({ label: v.kind === 'direct' ? 'Excluir conversa' : 'Excluir grupo', value: 'delete', danger: true });
    const c = await choiceSheet(session.roomTitle(v), opts);
    try {
      if (c === 'pin') await session.togglePin(v.roomId);
      if (c === 'archive') await session.setRoomFlag(v.roomId, { archived: !flag(v, 'archived') });
      if (c === 'unread') { if (unread) await session.markRead(v.roomId, S.clock.now() ?? Date.now()); else await session.markUnread(v.roomId); }
      if (c === 'delete') {
        const q = v.kind === 'direct' ? `Excluir a conversa com ${session.roomTitle(v)} só do seu aparelho? A outra pessoa continua vendo as mensagens até vencer.` : 'Excluir este grupo do seu aparelho? As outras pessoas continuam vendo até vencer.';
        if (!await confirmSheet(q, 'Excluir')) return;
        await session.deleteRoomForMe(v.roomId);
      }
      await render();
    } catch (e) { toast(errText(e)); }
  }

  function row({ v, last, unread }) {
    const muted = session.isMuted(v.roomId);
    const btn = h('button', { class: 'row-btn', onclick: () => go('chat', { roomId: v.roomId }) },
      avatar(session.roomTitle(v), session.roomPhoto(v)),
      h('span', { class: 'grow' },
        h('span', { class: 'title' }, session.roomTitle(v),
          flag(v, 'pinned') ? h('span', { class: 'flag', role: 'img', 'aria-label': 'fixada', title: 'fixada' }, icon('pin', 14)) : null,
          muted ? h('span', { class: 'flag', role: 'img', 'aria-label': 'silenciada', title: 'silenciada' }, icon('mute', 14)) : null),
        h('span', { class: unread ? 'preview unread small' : 'muted small preview', text: session.previewOf(v, last) })),
      h('span', { class: 'row-side' },
        last ? h('time', { class: unread ? 'small unread-time' : 'muted small', text: listTime(last.acceptedAt, S.clock.now() ?? Date.now()) }) : null,
        unread ? h('span', { class: muted ? 'badge muted-badge' : 'badge', 'aria-label': `${unread} não lida${unread > 1 ? 's' : ''}`, text: unread > 99 ? '99+' : String(unread) }) : null));
    onLongPress(btn, () => rowMenu(v));
    return h('li', {}, btn);
  }

  function draw() {
    const visible = rows.filter((r) => !r.hidden);
    const archived = visible.filter((r) => flag(r.v, 'archived'));
    const shown = showArchived ? archived : visible.filter((r) => !flag(r.v, 'archived'));
    archToggle.hidden = !archived.length && !showArchived;
    archToggle.textContent = showArchived ? '← Voltar às conversas' : `Arquivadas (${archived.length})`;
    list.replaceChildren(...(shown.length ? shown.map(row) : [h('li', { class: 'empty', text: showArchived ? 'Nenhuma conversa arquivada.' : 'Nenhuma conversa ainda. Busque alguém pelo apelido.' })]));
  }

  // E3: a primeira pintura usa a lista guardada da última abertura; a lista
  // atual chega logo depois. Um desenho mais antigo nunca cobre um mais novo.
  let started = 0, drawn = 0;
  const render = async ({ cached = false } = {}) => {
    const mine = ++started;
    await drawApproval();
    const saved = cached ? await session.cachedRooms() : null;
    const views = (saved ?? await session.listRooms()).filter(Boolean);
    // E3: as conversas são abertas juntas, não uma depois da outra.
    const next = await Promise.all(views.map(async (v) => {
      const r = await S.client.view(v.roomId);
      const last = r.render.at(-1);
      const at = last?.acceptedAt ?? 0;
      // D3: excluída só aparece de novo com mensagem nova.
      return { v, last, at, render: r.render, unread: session.unreadCount(v.roomId, r.render), hidden: session.isDeleted(v.roomId, at) };
    }));
    // Fixadas primeiro; depois a conversa com a mensagem mais recente.
    next.sort((a, b) => flag(b.v, 'pinned') - flag(a.v, 'pinned') || b.at - a.at);
    if (mine < drawn) return !!saved;
    drawn = mine;
    rows = next;
    draw();
    try { performance.mark(cached ? 'mp:list' : 'mp:list:fresh'); } catch {}
    return !!saved;
  };
  if (await render({ cached: true }).catch((e) => toast(`Não deu para carregar: ${e.message}`))) render().catch(() => {});
  return session.onChange((w) => { if (w === 'synced') render().catch(() => {}); });
}
