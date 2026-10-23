// Notificação (V6-021, §19): texto exatamente "novas mensagens", sem
// remetente, grupo, contagem, tipo, miniatura ou hora no conteúdo.
export const NOTIFICATION_TEXT = 'novas mensagens';

// Payload de push sempre igual e do mesmo tamanho.
export function pushPayload() {
  return JSON.stringify({ title: '', body: NOTIFICATION_TEXT, tag: 'mp' });
}

// Silenciar (§18): não muda prazo, cifra nem permissão.
export const MUTE_OPTIONS = [
  { label: '1 hora', seconds: 3600 },
  { label: '8 horas', seconds: 8 * 3600 },
  { label: '24 horas', seconds: 24 * 3600 },
  { label: '7 dias', seconds: 7 * 86400 },
  { label: 'Até reativar', seconds: null },
];
