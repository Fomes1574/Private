// Menu ⋮ da conversa. A líder controla só o futuro (prazos, membros, nome);
// nunca apaga conteúdo alheio (V7-010).
import { h, toast, choiceSheet, confirmSheet } from '../ui.js';
import * as session from '../session.js';
import { TTL_OPTIONS, describeTtl } from '../packages/protocol/src/ttl.js';

export async function roomMenu(go, roomId) {
  const S = session.S;
  const v = await session.roomView(roomId, true);
  const me = S.client.userId;
  const leader = v.leader === me;
  const opts = [{ label: 'Participantes e verificação', value: 'members' }];
  if (leader && !v.closed) {
    opts.push({ label: 'Prazos de mensagens e mídia', value: 'ttl' });
    if (v.kind === 'group') opts.push({ label: 'Nome do grupo', value: 'title' }, { label: 'Adicionar pessoa', value: 'add' }, { label: 'Remover pessoa', value: 'remove' });
    opts.push({ label: 'Ceder liderança', value: 'transfer' });
  }
  if (!v.closed) opts.push(v.kind === 'direct' ? { label: 'Desfazer vínculo', value: 'unlink', danger: true } : { label: 'Sair do grupo', value: 'leave', danger: true });
  if (leader && v.kind === 'group' && !v.closed) opts.push({ label: 'Encerrar o grupo', value: 'close', danger: true });
  const c = await choiceSheet(leader ? 'Você é a líder desta conversa' : `Líder: ${session.nameOf(v.leader)}`, opts);
  const active = v.members.filter((m) => m.active);
  try {
    if (c === 'members') return membersSheet(v);
    if (c === 'ttl') {
      const kind = await choiceSheet('Qual prazo mudar? Vale só para o que for enviado depois.', [{ label: `Mensagens (agora ${describeTtl(v.textTtl)})`, value: 'textTtl' }, { label: `Mídia (agora ${describeTtl(v.mediaTtl)})`, value: 'mediaTtl' }]);
      if (!kind) return;
      const s = await choiceSheet('Novo prazo', TTL_OPTIONS.map((x) => ({ label: describeTtl(x), value: x })));
      if (!s) return;
      await session.roomEvent(roomId, { type: 'set_policy', rev: v.policyRev + 1, [kind]: s });
      toast('Prazo alterado para as próximas mensagens.');
      return 'refresh';
    }
    if (c === 'title') {
      const t = await prompt('Nome do grupo', session.S.rooms[roomId]?.title ?? '');
      if (t) { await session.setRoomTitle(roomId, t); return 'refresh'; }
      return;
    }
    if (c === 'add') {
      const out = Object.entries(S.nicknames).filter(([u]) => !active.some((m) => m.userId === u));
      const u = await choiceSheet('Adicionar quem? A pessoa não vê nada do que veio antes.', out.map(([u, n]) => ({ label: n.nickname, value: u })));
      if (u) { const nv = await session.roomEvent(roomId, { type: 'add_member', member: u }); await S.client.announceMembership(roomId, nv); return 'refresh'; }
      return;
    }
    if (c === 'remove') {
      const u = await choiceSheet('Remover quem?', active.filter((m) => m.userId !== me).map((m) => ({ label: session.nameOf(m.userId), value: m.userId, danger: true })));
      if (u && await confirmSheet(`Remover ${session.nameOf(u)}? Perde o acesso ao que ainda não abriu.`, 'Remover')) { const nv = await session.roomEvent(roomId, { type: 'remove_member', member: u }); await S.client.announceMembership(roomId, nv); return 'refresh'; }
      return;
    }
    if (c === 'transfer') {
      const u = await choiceSheet('Ceder a liderança para quem? Não dá para desfazer.', active.filter((m) => m.userId !== me).map((m) => ({ label: session.nameOf(m.userId), value: m.userId })));
      if (u && await confirmSheet(`Ceder a liderança para ${session.nameOf(u)}? Você perde o posto.`, 'Ceder')) { const nv = await session.roomEvent(roomId, { type: 'transfer_leader', to: u }); await S.client.announceMembership(roomId, nv); return 'refresh'; }
      return;
    }
    if (c === 'leave' && await confirmSheet('Sair do grupo? Se você for a líder, assume quem entrou primeiro.', 'Sair')) {
      if (leader) await S.client.announceMembership(roomId, v, { leaving: true }); // passa a liderança cifrada antes de sair
      await session.roomEvent(roomId, { type: 'leave' });
      return go('chats');
    }
    if (c === 'unlink' && await confirmSheet('Desfazer vínculo? A conversa acaba; o outro lado fica só com leitura até vencer. Uma conversa nova começa do zero.', 'Desfazer')) { await session.roomEvent(roomId, { type: 'unlink' }); return 'refresh'; }
    if (c === 'close' && await confirmSheet('Encerrar o grupo? Ninguém mais envia nada.', 'Encerrar')) { await session.roomEvent(roomId, { type: 'close' }); return 'refresh'; }
  } catch (e) { toast(`Não deu: ${e.message}`); }
}

async function membersSheet(v) {
  const S = session.S;
  const rows = [];
  for (const m of v.members.filter((x) => x.active)) {
    const k = S.client.known[m.userId];
    const fp = k ? await session.fingerprint(k.curve) : '—';
    rows.push(h('li', {}, h('strong', { text: session.nameOf(m.userId) + (m.userId === v.leader ? ' · líder' : '') + (m.userId === S.client.userId ? ' (você)' : '') }),
      h('span', { class: 'code small', text: fp })));
  }
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'sheet-box' },
    h('p', { text: 'Para verificar alguém, encontrem-se e comparem os números. Se baterem, ninguém está no meio.' }),
    h('ul', { class: 'list' }, rows),
    h('button', { class: 'block', text: 'Fechar', onclick: () => sheet.remove() })));
  document.body.append(sheet);
}

function prompt(label, value) {
  return new Promise((resolve) => {
    const input = h('input', { maxlength: '60', value, 'aria-label': label });
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, h('form', { class: 'sheet-box', onsubmit: (e) => { e.preventDefault(); sheet.remove(); resolve(input.value.trim()); } },
      h('p', { text: label }), input,
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'secondary', text: 'Cancelar', onclick: () => { sheet.remove(); resolve(null); } }), h('button', { text: 'Salvar' }))));
    document.body.append(sheet);
    input.focus();
  });
}
