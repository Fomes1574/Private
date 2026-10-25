// Ordem obrigatória antes de mostrar qualquer coisa (§25.6, §49.3):
//   1) tempo confiável  2) revogações, apagar-para-todos, apagar-para-mim e
//   prazos  3) destruir o que venceu  4) só então liberar para a tela.
// Nunca renderizar primeiro e corrigir depois.
import { isExpired } from './ttl.js';

// messages: [{ msgId, expiresAt, ... }]
// tombstones: Set ou Map com os msgId apagados para todos (vindos do servidor)
// hiddenForMe: Set ou Map com os msgId apagados só por mim
// trustedNow: tempo do servidor ou null
export function reconcile({ messages, tombstones, hiddenForMe, trustedNow }) {
  if (trustedNow == null) {
    // Sem tempo confiável: falha fechada, nada aparece (V6-012).
    return { render: [], destroy: [], blocked: true };
  }
  const render = [], destroy = [];
  for (const m of messages) {
    if (tombstones.has(m.msgId) || isExpired(m.expiresAt, trustedNow)) destroy.push(m.msgId);
    else if (!hiddenForMe.has(m.msgId)) render.push(m);
  }
  return { render, destroy, blocked: false };
}

// Editar só nos primeiros 15 minutos, como no WhatsApp (D7). Quem recebe
// aceita uma folga para atraso de rede; quem envia respeita os 15 minutos.
export const EDIT_WINDOW_MS = 15 * 60_000;
export const EDIT_GRACE_MS = 5 * 60_000;

// Edição (V7-009): só o autor, versão crescente, mantém o prazo original.
export function applyEdit(original, edit) {
  if (edit.sender !== original.sender) throw new Error('só o autor edita');
  if (edit.body.target !== original.msgId) throw new Error('edição de outra mensagem');
  const current = original.editVersion ?? 0;
  if (edit.body.version <= current) return original; // edição velha ou repetida
  return { ...original, text: edit.body.text, editVersion: edit.body.version, edited: true, expiresAt: original.expiresAt };
}

// Apagar para todos (V7-010): só o autor; a líder não apaga conteúdo alheio.
export function canDeleteForAll(original, actor) {
  return original.sender === actor;
}
