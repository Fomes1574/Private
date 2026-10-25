// Textos dos avisos de segurança (S1), usados em Ajustes e na conversa.
import * as session from './session.js';
import { formatDateTime } from './packages/protocol/src/time.js';

export function warningText(w) {
  const who = session.nameOf(w.userId);
  switch (w.kind) {
    case 'key_changed': return w.verified
      ? `A chave de segurança de ${who} mudou. Vocês tinham conferido: o envio de mídia para ${who} fica pausado até conferirem de novo.`
      : `A chave de segurança de ${who} mudou (aparelho novo ou recuperação). Toque para verificar.`;
    case 'message_rejected': return `Uma mensagem de ${who} não passou na verificação e foi descartada sem abrir. Se repetir, verifiquem os números pessoalmente.`;
    case 'unconfirmed_member': return 'O servidor indicou numa conversa alguém que a líder não anunciou. Nada foi enviado. Avisem a líder.';
    case 'unconfirmed_circle': return 'O servidor indicou no círculo alguém que a administradora não confirmou. Essa pessoa não recebe apelido, foto nem stories.';
    case 'ttl_clamped': return 'O servidor tentou dar a uma mensagem um prazo maior que o combinado. O aparelho manteve o prazo certo.';
    case 'membership_rejected': return `Um anúncio de membros de ${session.nameOf(w.from)} não veio da líder confirmada e foi ignorado.`;
    case 'send_failed': return 'Uma mensagem que estava na fila não pôde ser enviada (a conversa mudou ou passou muito tempo). Ela não foi entregue.';
    case 'circle_joined': return `${who} entrou no círculo.`;
    case 'circle_removed': return `${who} saiu do círculo.`;
    case 'circle_device_changed': return `${who} trocou de aparelho.`;
    case 'circle_recovered': return `${who} recuperou a conta num aparelho novo.`;
    default: return 'Aviso de segurança. Verifiquem os números pessoalmente.';
  }
}
export const warningWhen = (w) => (w.at ? formatDateTime(w.at) : '');
