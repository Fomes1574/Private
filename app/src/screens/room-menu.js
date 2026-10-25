// Menu ⋮ da conversa. A líder controla só o futuro (prazos, membros, nome);
// nunca apaga conteúdo alheio (V7-010).
import { h, toast, choiceSheet, confirmSheet, errText } from '../ui.js';
import * as session from '../session.js';
import { TTL_OPTIONS, describeTtl } from '../packages/protocol/src/ttl.js';
import { pickSquarePhoto } from './settings.js';
import { pickImage } from '../pick-image.js';
import { verifySheet } from './verify.js';
import { formatDateTime } from '../packages/protocol/src/time.js';

// Fundo: até 1280 px, sem metadados; câmera traseira.
const pickBackground = (roomId, local = false) => pickImage({ maxSide: 1280, facing: 'environment', resume: { roomId, target: 'chat', action: local ? 'wallpaper' : 'room-background' } });

export async function roomMenu(go, roomId) {
  const S = session.S;
  const v = await session.roomView(roomId, true);
  const me = S.client.userId;
  const leader = v.leader === me;
  const flags = S.rooms[roomId] ?? {};
  const opts = [{ label: 'Buscar nesta conversa', value: 'search' }, { label: 'Participantes e verificação', value: 'members' },
    { label: 'Mídia, documentos e favoritas', value: 'gallery' },
    ...(v.kind === 'direct' ? [{ label: 'Papel de parede (só neste aparelho)', value: 'wallpaper' }] : []),
    { label: session.isMuted(roomId) ? 'Reativar avisos' : 'Silenciar', value: 'mute' },
    { label: flags.pinned ? 'Desafixar' : 'Fixar no topo', value: 'pin' },
    { label: flags.archived ? 'Desarquivar' : 'Arquivar', value: 'archive' }];
  if (v.kind === 'group' && !v.closed && session.imActive(v)) opts.push({ label: 'Criar enquete', value: 'poll' });
  if (leader && !v.closed) {
    opts.push({ label: 'Prazos de mensagens e mídia', value: 'ttl' });
    if (v.kind === 'group') opts.push({ label: 'Nome do grupo', value: 'title' }, { label: 'Descrição do grupo', value: 'description' }, { label: 'Foto do grupo', value: 'photo' }, { label: 'Fundo da conversa', value: 'background' }, { label: 'Adicionar pessoa', value: 'add' }, { label: 'Remover pessoa', value: 'remove' });
    opts.push({ label: 'Ceder liderança', value: 'transfer' });
  }
  // D3, como no WhatsApp: limpar e excluir valem só neste aparelho. Grupo só
  // se exclui depois de sair.
  const inGroup = session.imActive(v);
  opts.push({ label: 'Limpar conversa', value: 'clear', danger: true });
  if (v.kind === 'direct') opts.push({ label: 'Excluir conversa', value: 'delete', danger: true });
  else if (!inGroup || v.closed) opts.push({ label: 'Excluir grupo', value: 'delete', danger: true });
  if (!v.closed) opts.push(v.kind === 'direct' ? { label: 'Desfazer vínculo', value: 'unlink', danger: true } : inGroup ? { label: 'Sair do grupo', value: 'leave', danger: true } : null);
  if (leader && v.kind === 'group' && !v.closed) opts.push({ label: 'Encerrar o grupo', value: 'close', danger: true });
  const shown = opts.filter(Boolean);
  const c = await choiceSheet(leader ? 'Você é a líder desta conversa' : `Líder: ${session.nameOf(v.leader)}`, shown);
  const active = v.members.filter((m) => m.active);
  try {
    if (c === 'members') return membersSheet(v);
    if (c === 'gallery') return gallerySheet(roomId);
    if (c === 'wallpaper') {
      const has = !!((await S.store.get('wallpapers')) ?? {})[roomId];
      const a = has ? await choiceSheet('Papel de parede (só neste aparelho, cifrado)', [{ label: 'Trocar', value: 'set' }, { label: 'Remover', value: 'rm', danger: true }]) : 'set';
      if (a === 'rm') { await session.setWallpaper(roomId, null); toast('Papel de parede removido.'); return 'refresh'; }
      if (a !== 'set') return;
      const b = await pickBackground(roomId, true);
      if (!b) return;
      try { await session.setWallpaper(roomId, b); } finally { b.fill(0); }
      toast('Papel de parede trocado.');
      return 'refresh';
    }
    if (c === 'description') {
      const t = await prompt('Descrição do grupo (só quem está no grupo vê, cifrada)', S.rooms[roomId]?.description ?? '', 512);
      if (t === null) return;
      await session.setRoomDescription(roomId, t.trim());
      toast('Descrição salva.');
      return;
    }
    if (c === 'poll') return 'poll';
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
    if (c === 'pin') { const on = await session.togglePin(roomId); toast(on ? 'Fixada no topo.' : 'Desafixada.'); return; }
    if (c === 'archive') { await session.setRoomFlag(roomId, { archived: !flags.archived }); toast(flags.archived ? 'Desarquivada.' : 'Arquivada. Fica em "Arquivadas" na lista.'); return; }
    if (c === 'clear') {
      if (!await confirmSheet('Limpar esta conversa? As mensagens somem só deste aparelho; a conversa continua na lista. Os outros continuam vendo até vencer.', 'Limpar conversa')) return;
      const n = await session.clearRoom(roomId);
      toast(n ? 'Conversa limpa neste aparelho.' : 'Nada para limpar.');
      return 'refresh';
    }
    if (c === 'delete') {
      const who = v.kind === 'direct' ? session.roomTitle(v) : 'As outras pessoas';
      const q = v.kind === 'direct'
        ? `Excluir esta conversa só do seu aparelho? ${who} continua vendo as mensagens até vencer. Se chegar mensagem nova, ela volta para a lista.`
        : 'Excluir este grupo do seu aparelho? Nome, foto e mensagens somem daqui. As outras pessoas continuam vendo até vencer.';
      if (!await confirmSheet(q, v.kind === 'direct' ? 'Excluir conversa' : 'Excluir grupo')) return;
      await session.deleteRoomForMe(roomId);
      toast(v.kind === 'direct' ? 'Conversa excluída deste aparelho.' : 'Grupo excluído deste aparelho.');
      return go('chats');
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
        const b = c === 'photo' ? await pickSquarePhoto('environment', { roomId, target: 'chat', action: 'room-photo' }) : await pickBackground(roomId);
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
      await session.markLeft(roomId); // fica na lista só para leitura até excluir
      return 'refresh';
    }
    if (c === 'unlink' && await confirmSheet('Desfazer vínculo? A conversa acaba; o outro lado fica só com leitura até vencer. Uma conversa nova começa do zero.', 'Desfazer')) { await session.roomEvent(roomId, { type: 'unlink' }); return 'refresh'; }
    if (c === 'close' && await confirmSheet('Encerrar o grupo? Ninguém mais envia nada.', 'Encerrar')) { await session.roomEvent(roomId, { type: 'close' }); return 'refresh'; }
  } catch (e) { toast(`Não deu: ${errText(e)}`); }
}

async function membersSheet(v) {
  const S = session.S;
  const rows = [];
  for (const m of v.members.filter((x) => x.active)) {
    const me = m.userId === S.client.userId;
    const mark = me ? '' : session.isVerified(m.userId) ? ' · ✓ verificado' : session.keyChanged(m.userId) ? ' · chave mudou' : '';
    rows.push(h('li', {}, h('strong', { text: session.nameOf(m.userId) + (m.userId === v.leader ? ' · líder' : '') + (me ? ' (você)' : '') + mark }),
      session.aboutOf(m.userId) ? h('span', { class: 'muted small', text: session.aboutOf(m.userId) }) : null,
      me ? null : h('button', { class: 'secondary small', text: 'Verificar', onclick: () => { sheet.remove(); verifySheet(m.userId); } })));
  }
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'sheet-box' },
    S.rooms[v.roomId]?.description ? h('p', { class: 'muted', text: S.rooms[v.roomId].description }) : null,
    h('p', { text: 'Para verificar alguém, encontrem-se e leiam o QR ou comparem o número de segurança. Se baterem, ninguém está no meio.' }),
    h('ul', { class: 'list' }, rows),
    h('button', { class: 'block', text: 'Fechar', onclick: () => sheet.remove() })));
  document.body.append(sheet);
}

function prompt(label, value, max = 60) {
  return new Promise((resolve) => {
    const input = h('input', { maxlength: String(max), value, 'aria-label': label });
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, h('form', { class: 'sheet-box', onsubmit: (e) => { e.preventDefault(); sheet.remove(); resolve(input.value.trim()); } },
      h('p', { text: label }), input,
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'secondary', text: 'Cancelar', onclick: () => { sheet.remove(); resolve(null); } }), h('button', { text: 'Salvar' }))));
    document.body.append(sheet);
    input.focus();
  });
}

// Mídia, documentos e favoritas da conversa (b.12, b.13), como no WhatsApp.
// Sem miniaturas (passo 22): só a lista; tocar abre na conversa. Ver uma vez
// não aparece aqui.
async function gallerySheet(roomId) {
  const r = await session.S.client.view(roomId);
  const media = r.render.filter((m) => m.kind === 'media' && m.body?.mode !== 'once').reverse();
  const starred = r.render.filter((m) => m.starred).reverse();
  const label = (m) => m.kind === 'media' ? `${m.body.mode === 'doc' ? `📄 ${m.body.name ?? 'Documento'}` : /^audio\//.test(m.body.mime) ? '🎤 Áudio' : /^video\//.test(m.body.mime) ? '🎥 Vídeo' : '📷 Foto'}` : (m.text ?? m.body?.question ?? '').slice(0, 80);
  const row = (m) => h('li', { class: 'small' }, `${label(m)} · ${session.nameOf(m.sender)} · ${formatDateTime(m.acceptedAt)}`);
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'sheet-box' },
    h('h2', { text: 'Mídia e documentos' }),
    media.length ? h('ul', { class: 'list' }, media.map(row)) : h('p', { class: 'muted small', text: 'Nada por aqui.' }),
    h('h2', { text: 'Favoritas ⭐' }),
    starred.length ? h('ul', { class: 'list' }, starred.map(row)) : h('p', { class: 'muted small', text: 'Segure uma mensagem e toque em Favoritar. Favoritas ficam só neste aparelho e somem quando a mensagem vence.' }),
    h('button', { class: 'block', text: 'Fechar', onclick: () => sheet.remove() })));
  document.body.append(sheet);
}
