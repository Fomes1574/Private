// Conteúdo interno das mensagens (ADR 0003, V7-003, V7-018, V7-021).
// Tudo vai dentro do envelope autenticado; o servidor não vê o tipo.
export const INNER_VERSION = 1;

export const KINDS = new Set([
  'text', 'reaction', 'edit', 'delete_for_all', 'media', 'policy', 'leader_transfer',
  'nickname_change', 'membership', 'unlink', 'room_profile',
]);

// Escada de tamanhos: o texto cifrado só revela em qual degrau o conteúdo cai.
export const PAD_STEPS = [256, 1024, 4096, 16384, 65536];
export const MAX_INNER = PAD_STEPS.at(-1) - 4;

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

export function pad(bytes) {
  if (bytes.byteLength > MAX_INNER) throw new RangeError('conteúdo grande demais para o envelope');
  const size = PAD_STEPS.find((s) => s >= bytes.byteLength + 4);
  const out = new Uint8Array(size); // zeros depois do conteúdo
  new DataView(out.buffer).setUint32(0, bytes.byteLength);
  out.set(bytes, 4);
  return out;
}

export function unpad(padded) {
  if (!PAD_STEPS.includes(padded.byteLength)) throw new Error('tamanho de envelope fora da escada');
  const len = new DataView(padded.buffer, padded.byteOffset).getUint32(0);
  if (len > padded.byteLength - 4) throw new Error('comprimento interno inválido');
  for (let i = 4 + len; i < padded.byteLength; i++) if (padded[i] !== 0) throw new Error('preenchimento adulterado');
  return padded.subarray(4, 4 + len);
}

// Foto JPEG/WebP, vídeo MP4, áudio Opus (WebM/Ogg) ou AAC/MP4 do Safari.
export const MEDIA_MIME = /^(image\/(jpeg|webp)|video\/mp4|audio\/(webm|ogg|mp4|aac))(;\s?codecs="?[a-z0-9.]+"?)?$/;
// Documentos (P-12, lista positiva): por enquanto só texto UTF-8, que o app
// mostra como texto puro, nunca como HTML. PDF e outros esperam a decisão.
export const DOC_MIME = /^text\/plain;charset=utf-8$/;
// Nome do arquivo: só para exibir; sem barras, sem caracteres de controle.
export const validDocName = (n) => typeof n === 'string' && n.length >= 1 && n.length <= 100 && !/[\u0000-\u001f\u007f/\\]/.test(n);
const ID = /^[A-Za-z0-9_-]{8,64}$/;

// Valida a estrutura. Não decide permissão (isso é de policy.js).
export function validateInner(m) {
  const fail = (why) => { throw new Error(`mensagem inválida: ${why}`); };
  if (!m || typeof m !== 'object') fail('não é objeto');
  if (m.v !== INNER_VERSION) fail(`versão ${m.v}`);
  if (!KINDS.has(m.kind)) fail(`tipo ${m.kind}`);
  for (const k of ['msgId', 'room', 'sender']) if (!ID.test(m[k] ?? '')) fail(k);
  if (!Number.isSafeInteger(m.policyRev) || m.policyRev < 0) fail('policyRev');
  switch (m.kind) {
    case 'text': if (typeof m.body?.text !== 'string' || m.body.text.length === 0) fail('texto vazio'); break;
    case 'reaction': if (!ID.test(m.body?.target ?? '') || typeof m.body.emoji !== 'string' || [...m.body.emoji].length > 8) fail('reação'); break;
    case 'edit': if (!ID.test(m.body?.target ?? '') || typeof m.body.text !== 'string' || !Number.isSafeInteger(m.body.version) || m.body.version < 1) fail('edição'); break;
    case 'delete_for_all': if (!ID.test(m.body?.target ?? '')) fail('apagar'); break;
    case 'nickname_change': if (typeof m.body?.nickname !== 'string' || m.body.nickname.trim().length < 2 || m.body.nickname.length > 24) fail('apelido'); break;
    case 'membership':
      if (!Array.isArray(m.body?.members) || m.body.members.length < 1 || m.body.members.length > 10 || !m.body.members.every((x) => ID.test(x)) || !ID.test(m.body.leader ?? '') || !m.body.members.includes(m.body.leader)) fail('membros');
      break;
    case 'room_profile': if (typeof m.body?.title !== 'string' || m.body.title.length > 60) fail('nome do grupo'); break;
    case 'media': {
      const b = m.body;
      if (!ID.test(b?.mediaId ?? '') || typeof b.key !== 'string' || !['once', 'media', 'doc'].includes(b.mode)) fail('mídia');
      // V7-016: só formatos que o próprio app gera ao recodificar. Qualquer
      // outro tipo é recusado antes de chegar perto de um decodificador.
      if (!(b.mode === 'doc' ? DOC_MIME : MEDIA_MIME).test(b.mime ?? '')) fail('tipo de mídia');
      if (b.name !== undefined && (b.mode !== 'doc' || !validDocName(b.name))) fail('nome do documento');
      if (b.mode === 'once' && !/^(image|video)\//.test(b.mime)) fail('ver uma vez só para foto ou vídeo');
      if (b.duration !== undefined && !(Number.isSafeInteger(b.duration) && b.duration >= 0 && b.duration <= 3_600_000 + 5_000)) fail('duração');
      break;
    }
    default: break;
  }
  if (m.replyTo !== undefined && !ID.test(m.replyTo)) fail('replyTo');
  return m;
}

export function encodeInner(m) {
  return pad(enc.encode(JSON.stringify(validateInner(m))));
}

export function decodeInner(padded) {
  return validateInner(JSON.parse(dec.decode(unpad(padded))));
}
