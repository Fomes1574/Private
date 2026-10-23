// Menu ⋮ da conversa. A líder controla só o futuro (prazos, membros, nome);
// nunca apaga conteúdo alheio (V7-010).
import { h, toast, choiceSheet, confirmSheet, errText } from '../ui.js';
import * as session from '../session.js';
import { TTL_OPTIONS, describeTtl } from '../packages/protocol/src/ttl.js';
import { pickSquarePhoto } from './settings.js';
import { preparePhoto } from '../media.js';

// Fundo: escolhe imagem, recodifica (até 1280 px, sem metadados).
function pickBackground() {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'image/*', hidden: true });
    input.onchange = async () => {
      const f = input.files[0];
      input.remove();
      if (!f) return resolve(null);
      try { resolve((await preparePhoto(f, { maxSide: 1280 })).bytes); } catch (e) { toast(e.message); resolve(null); }
    };
    document.body.append(input);
    input.click();
  });
}

export async function roomMenu(go, roomId) {
  const S = session.S;
  const v = await session.roomView(roomId, true);
  const me = S.client.userId;
  const leader = v.leader === me;
  const flags = S.rooms[roomId] ?? {};
  const opts = [{ label: 'Buscar nesta conversa', value: 'search' }, { label: 'Participantes e verificação', value: 'members' },
    { label: session.isMuted(roomId) ? 'Reativar avisos' : 'Silenciar', value: 'mute' },
    { label: flags.pinned ? 'Desafixar' : 'Fixar no topo', value: 'pin' },
    { label: flags.archived ? 'Desarquivar' : 'Arquivar', value: 'archive' }];
  if (leader && !v.closed) {
    opts.push({ label: 'Prazos de mensagens e mídia', value: 'ttl' });
    if (v.kind === 'group') opts.push({ label: 'Nome do grupo', value: 'title' }, { label: 'Foto do grupo', value: 'photo' }, { label: 'Fundo da conversa', value: 'background' }, { label: 'Adicionar pessoa', value: 'add' }, { label: 'Remover pessoa', value: 'remove' });
    opts.push({ label: 'Ceder liderança', value: 'transfer' });
  }
  opts.push({ label: 'Apagar conversa (só para mim)', value: 'clear', danger: true });
  if (!v.closed) opts.push(v.kind === 'direct' ? { label: 'Desfazer vínculo', value: 'unlink', danger: true } : { label: 'Sair do grupo', value: 'leave', danger: true });
  if (leader && v.kind === 'group' && !v.closed) opts.push({ label: 'Encerrar o grupo', value: 'close', danger: true });
  const c = await choiceSheet(leader ? 'Você é a líder desta conversa' : `Líder: ${session.nameOf(v.leader)}`, opts);
  const active = v.members.filter((m) => m.active);
  try {
    if (c === 'members') return membersSheet(v);
    if (c === 'search') return 'search';
    if (c === 'mute') {
      if (session.isMuted(roomId)) { await session.muteRoom(roomId, 0); toast('Avisos reativados.'); return; }
      const H = 3600_000;
      const d = await choiceSheet('Silenciar por quanto tempo? As mensagens chegam e somem no prazo de sempre; só o aviso deixa de tocar.',
        [{ label: '1 hora', value: H }, { label: '8 horas', value: 8 * H }, { label: '24 horas', value: 24 * H }, { label: '7 dias', value: 168 * H }, { label: 'Até reativar', value: -1 }]);
      if (!d) return;
      await session.muteRoom(roomId, d === -1 ? Date.now() + 100 * 365 * 24 * H : Date.now() + d);
      toast('Conversa silenciada.');
      return;
    }
    if (c === 'pin') { await session.setRoomFlag(roomId, { pinned: !flags.pinned }); toast(flags.pinned ? 'Desafixada.' : 'Fixada no topo.'); return; }
    if (c === 'archive') { await session.setRoomFlag(roomId, { archived: !flags.archived }); toast(flags.archived ? 'Desarquivada.' : 'Arquivada. Fica em "Arquivadas" na lista.'); return; }
    if (c === 'clear') {
      if (!await confirmSheet('Apagar todas as mensagens desta conversa só deste aparelho? Os outros continuam vendo até o prazo. Não dá para desfazer.', 'Apagar conversa')) return;
      const n = await S.client.clearRoomForMe(roomId);
      toast(n ? 'Conversa apagada deste aparelho.' : 'Nada para apagar.');
      return 'refresh';
    }
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
    if (c === 'photo' || c === 'background') {
      const what = c === 'photo' ? 'Foto do grupo' : 'Fundo da conversa';
      const has = !!S.rooms[roomId]?.[c];
      const a = has ? await choiceSheet(`${what} (só quem está no grupo vê, cifrado)`, [{ label: 'Trocar', value: 'set' }, { label: 'Remover', value: 'rm', danger: true }]) : 'set';
      if (a === 'set') {
        const b = c === 'photo' ? await pickSquarePhoto() : await pickBackground();
        if (!b) return;
        try { await session.setRoomVisual(roomId, c, b); } finally { b.fill(0); }
        toast(`${what} trocada. A anterior foi apagada.`);
        return 'refresh';
      }
      if (a === 'rm') { await session.setRoomVisual(roomId, c, null); toast(`${what} removida.`); return 'refresh'; }
      return;
    }
    if (c === 'add') {
      const out = Object.entries(S.nicknames).filter(([u]) => !active.some((m) => m.userId === u));
      const u = await choiceSheet('Adicionar quem? A pessoa não vê nada do que veio antes.', out.map(([u, n]) => ({ label: n.nickname, value: u })));
      if (u) {
        const nv = await session.roomEvent(roomId, { type: 'add_member', member: u });
        await S.client.announceMembership(roomId, nv);
        await session.sendRoomProfile(roomId); // nome, foto e fundo para quem entrou
        return 'refresh';
      }
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
  } catch (e) { toast(`Não deu: ${errText(e)}`); }
}

async function membersSheet(v) {
  const S = session.S;
  const rows = [];
  for (const m of v.members.filter((x) => x.active)) {
    const k = S.client.known[m.userId];
    const fp = k ? await session.fingerprint(k.curve) : '—';
    rows.push(h('li', {}, h('strong', { text: session.nameOf(m.userId) + (m.userId === v.leader ? ' · líder' : '') + (m.userId === S.client.userId ? ' (você)' : '') }),
      session.aboutOf(m.userId) ? h('span', { class: 'muted small', text: session.aboutOf(m.userId) }) : null,
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
