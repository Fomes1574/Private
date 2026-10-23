// Estado de uma conversa (1:1 ou grupo) a partir de eventos autenticados.
// Regras: V7-004 (quem inicia o 1:1 é líder), V7-005 (ceder é irreversível),
// V6-010 (prazos separados, só para o futuro), V6-023 (sucessão pelo membro
// ativo mais antigo), V7-008 (desfazer vínculo), V7-010 (líder não apaga
// conteúdo alheio: não há evento para isso).
import { assertTtl, DEFAULT_TTL, MAX_TTL } from './ttl.js';

// Conversa do círculo: todos os membros ativos, mantida pelo servidor. Só
// transporta anúncios cifrados de perfil (apelido, V7-006), reenviados quando
// alguém entra. Ninguém altera política, liderança ou membros dela.
export const CIRCLE_ROOM_ID = 'circulo-0000000000';

export class RoomError extends Error {}
const no = (why) => { throw new RoomError(why); };

export const MAX_MEMBERS = 10;

function clone(s) {
  return { ...s, members: new Map([...s.members].map(([k, v]) => [k, { ...v }])) };
}

const active = (s) => [...s.members].filter(([, m]) => m.active);

// Sucessor = membro ativo com a menor ordem de ingresso (§49.4). A ordem é
// atribuída pelo servidor em sequência, então não há empate.
export function successor(s, excluding) {
  const cand = active(s).filter(([id]) => id !== excluding).sort((a, b) => a[1].joinSeq - b[1].joinSeq);
  return cand.length ? cand[0][0] : null;
}

export function createRoom({ roomId, kind, creator, members, textTtl = DEFAULT_TTL, mediaTtl = DEFAULT_TTL }) {
  if (!['direct', 'group', 'circle'].includes(kind)) no('tipo de conversa');
  if (kind === 'circle') { textTtl = MAX_TTL; mediaTtl = MAX_TTL; }
  const others = [...new Set(members)].filter((m) => m !== creator);
  if (kind === 'direct' && others.length !== 1) no('conversa 1:1 tem exatamente duas pessoas');
  if (others.length + 1 > MAX_MEMBERS) no('mais de 10 pessoas');
  const s = {
    roomId, kind, leader: creator, policyRev: 1,
    textTtl: assertTtl(textTtl), mediaTtl: assertTtl(mediaTtl),
    closed: false, nextJoinSeq: 0, members: new Map(),
  };
  for (const m of [creator, ...others]) s.members.set(m, { joinSeq: s.nextJoinSeq++, active: true });
  return s;
}

export function isMember(s, id) { return !!s.members.get(id)?.active; }

// Aplica um evento e devolve um NOVO estado (o anterior não muda).
export function apply(state, ev) {
  if (state.closed && ev.type !== 'noop') no('conversa encerrada');
  const s = clone(state);
  const actorIsMember = isMember(s, ev.actor);
  if (!actorIsMember) no('quem age não é membro ativo');
  const leaderOnly = () => { if (ev.actor !== s.leader) no('só a líder pode'); };
  if (s.kind === 'circle') no('a conversa do círculo é mantida pelo servidor');

  switch (ev.type) {
    case 'set_policy': {
      leaderOnly();
      if (ev.rev !== s.policyRev + 1) no('revisão de política fora de ordem');
      if (ev.textTtl !== undefined) s.textTtl = assertTtl(ev.textTtl);
      if (ev.mediaTtl !== undefined) s.mediaTtl = assertTtl(ev.mediaTtl);
      s.policyRev = ev.rev;
      return s;
    }
    case 'transfer_leader': {
      leaderOnly();
      if (!isMember(s, ev.to) || ev.to === ev.actor) no('nova líder precisa ser outro membro ativo');
      s.leader = ev.to; // irreversível: quem cede perde o posto (V7-005)
      return s;
    }
    case 'add_member': {
      leaderOnly();
      if (s.kind === 'direct') no('não se adiciona gente a conversa 1:1');
      if (active(s).length >= MAX_MEMBERS) no('grupo cheio');
      if (isMember(s, ev.member)) no('já é membro');
      // Quem volta ganha ordem nova: perde a prioridade antiga (§49.4).
      s.members.set(ev.member, { joinSeq: s.nextJoinSeq++, active: true });
      return s;
    }
    case 'remove_member':
    case 'leave': {
      const target = ev.type === 'leave' ? ev.actor : ev.member;
      if (ev.type === 'remove_member') { leaderOnly(); if (target === ev.actor) no('para sair use leave'); }
      if (!isMember(s, target)) no('não é membro ativo');
      if (s.kind === 'direct') no('em 1:1 use unlink (desfazer vínculo)');
      s.members.get(target).active = false;
      if (target === s.leader) s.leader = successor(s, target);
      if (!s.leader) s.closed = true; // ninguém sobrou
      return s;
    }
    case 'unlink': {
      // Desfazer vínculo (V7-008): encerra a conversa; nova conversa = novo id.
      if (s.kind !== 'direct') no('unlink só em 1:1');
      s.closed = true;
      s.closedBy = ev.actor;
      return s;
    }
    case 'close': {
      leaderOnly();
      s.closed = true;
      s.closedBy = ev.actor;
      return s;
    }
    default:
      no(`evento desconhecido: ${ev.type}`);
  }
}

// Prazo que vale para uma mensagem nova, carimbado no aceite (V6-010).
export function ttlFor(s, kind) {
  if (s.closed) no('conversa encerrada não recebe mensagens');
  return kind === 'media' ? s.mediaTtl : s.textTtl;
}

// Entrada e saída na conversa do círculo, feitas pelo servidor (não por pessoas).
export function systemJoin(state, userId) {
  if (state.kind !== 'circle') throw new RoomError('só na conversa do círculo');
  if (isMember(state, userId)) return state;
  const s = clone(state);
  s.members.set(userId, { joinSeq: s.nextJoinSeq++, active: true });
  return s;
}

export function systemLeave(state, userId) {
  if (!isMember(state, userId)) return state;
  const s = clone(state);
  s.members.get(userId).active = false;
  if (s.leader === userId) s.leader = successor(s, userId);
  return s;
}
