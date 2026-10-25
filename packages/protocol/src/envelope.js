// Conteúdo interno das mensagens (ADR 0003, V7-003, V7-018, V7-021).
// Tudo vai dentro do envelope autenticado; o servidor não vê o tipo.
import { isValidTtl } from './ttl.js';

export const INNER_VERSION = 1;

export const KINDS = new Set([
  'text', 'reaction', 'edit', 'delete_for_all', 'media', 'story', 'policy', 'leader_transfer',
  'nickname_change', 'membership', 'unlink', 'room_profile',
  // Entregas C e D: fixar mensagem, enquete e voto (como no WhatsApp).
  'pin', 'poll', 'vote',
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
// Documentos (P-12): lista positiva. Texto UTF-8 e PDF, ambos mostrados
// dentro do app (texto puro; PDF só desenhado, sem scripts nem links).
export const DOC_MIME = /^(text\/plain;charset=utf-8|application\/pdf)$/;
// Nome do arquivo: só para exibir; sem barras, sem caracteres de controle.
export const validDocName = (n) => typeof n === 'string' && n.length >= 1 && n.length <= 100 && !/[\u0000-\u001f\u007f/\\]/.test(n);
const ID = /^[A-Za-z0-9_-]{8,64}$/;
// Foto de perfil/grupo ou fundo: id do objeto + chave AES-256 em base64.
// Ausente (não mexe), null (removida) ou referência válida.
const KEY_B64 = /^[A-Za-z0-9+/]{43}=$/;
const visualRef = (r) => r === undefined || r === null || (typeof r === 'object' && ID.test(r.mediaId ?? '') && KEY_B64.test(r.key ?? '') && Object.keys(r).length === 2);

// Valida a estrutura. Não decide permissão (isso é de policy.js).
export function validateInner(m) {
  const fail = (why) => { throw new Error(`mensagem inválida: ${why}`); };
  if (!m || typeof m !== 'object') fail('não é objeto');
  if (m.v !== INNER_VERSION) fail(`versão ${m.v}`);
  if (!KINDS.has(m.kind)) fail(`tipo ${m.kind}`);
  for (const k of ['msgId', 'room', 'sender']) if (!ID.test(m[k] ?? '')) fail(k);
  if (!Number.isSafeInteger(m.policyRev) || m.policyRev < 0) fail('policyRev');
  // Prazo que quem enviou espera (segundos). Vai cifrado: o servidor não
  // consegue esticar a vida da mensagem no aparelho de quem recebe.
  if (m.ttl !== undefined && !isValidTtl(m.ttl)) fail('prazo');
  switch (m.kind) {
    case 'text': if (typeof m.body?.text !== 'string' || m.body.text.length === 0) fail('texto vazio'); break;
    case 'reaction': if (!ID.test(m.body?.target ?? '') || typeof m.body.emoji !== 'string' || [...m.body.emoji].length > 8) fail('reação'); break;
    case 'edit': if (!ID.test(m.body?.target ?? '') || typeof m.body.text !== 'string' || !Number.isSafeInteger(m.body.version) || m.body.version < 1) fail('edição'); break;
    case 'delete_for_all': if (!ID.test(m.body?.target ?? '')) fail('apagar'); break;
    case 'nickname_change':
      if (typeof m.body?.nickname !== 'string' || m.body.nickname.trim().length < 2 || m.body.nickname.length > 24) fail('apelido');
      if (!visualRef(m.body.photo)) fail('foto de perfil');
      if (m.body.about !== undefined && m.body.about !== null && (typeof m.body.about !== 'string' || m.body.about.length > 140)) fail('recado');
      break;
    case 'membership':
      if (!Array.isArray(m.body?.members) || m.body.members.length < 1 || m.body.members.length > 10 || !m.body.members.every((x) => ID.test(x)) || !ID.test(m.body.leader ?? '') || !m.body.members.includes(m.body.leader)) fail('membros');
      if (m.body.revision !== undefined && (!Number.isSafeInteger(m.body.revision) || m.body.revision < 1)) fail('versão dos membros');
      break;
    case 'room_profile':
      if (typeof m.body?.title !== 'string' || m.body.title.length > 60) fail('nome do grupo');
      if (m.body.description !== undefined && m.body.description !== null && (typeof m.body.description !== 'string' || m.body.description.length > 512)) fail('descrição do grupo');
      if (!visualRef(m.body.photo) || !visualRef(m.body.background)) fail('foto ou fundo do grupo');
      break;
    case 'media': {
      const b = m.body;
      if (!ID.test(b?.mediaId ?? '') || typeof b.key !== 'string' || !['once', 'media', 'doc'].includes(b.mode)) fail('mídia');
      // V7-016: só formatos que o próprio app gera ao recodificar. Qualquer
      // outro tipo é recusado antes de chegar perto de um decodificador.
      if (!(b.mode === 'doc' ? DOC_MIME : MEDIA_MIME).test(b.mime ?? '')) fail('tipo de mídia');
      if (b.name !== undefined && (b.mode !== 'doc' || !validDocName(b.name))) fail('nome do documento');
      // Ver uma vez: foto, vídeo ou áudio (b.7), como no WhatsApp.
      if (b.mode === 'once' && !/^(image|video|audio)\//.test(b.mime)) fail('ver uma vez só para foto, vídeo ou áudio');
      if (b.round !== undefined && (b.round !== true || !/^video\//.test(b.mime))) fail('vídeo redondo');
      if (b.hd !== undefined && (b.hd !== true || !/^image\//.test(b.mime))) fail('foto HD');
      if (b.caption !== undefined && (typeof b.caption !== 'string' || b.caption.length > 1000 || b.mode === 'once')) fail('legenda');
      if (b.duration !== undefined && !(Number.isSafeInteger(b.duration) && b.duration >= 0 && b.duration <= 3_600_000 + 5_000)) fail('duração');
      break;
    }
    case 'story': {
      // Story (§22): só foto ou vídeo, legenda opcional; vai na conversa do círculo.
      const b = m.body;
      if (!ID.test(b?.mediaId ?? '') || typeof b.key !== 'string' || !/^(image\/(jpeg|webp)|video\/mp4)$/.test(b.mime ?? '')) fail('story');
      if (b.caption !== undefined && (typeof b.caption !== 'string' || b.caption.length > 1000)) fail('legenda');
      if (b.duration !== undefined && !(Number.isSafeInteger(b.duration) && b.duration >= 0 && b.duration <= 300_000 + 5_000)) fail('duração');
      break;
    }
    case 'pin': // fixar (until > 0) ou desafixar (until = 0) uma mensagem
      if (!ID.test(m.body?.target ?? '') || !Number.isSafeInteger(m.body.until) || m.body.until < 0) fail('fixar');
      break;
    case 'poll': {
      const b = m.body;
      if (typeof b?.question !== 'string' || !b.question.trim() || b.question.length > 255) fail('pergunta da enquete');
      if (!Array.isArray(b.options) || b.options.length < 2 || b.options.length > 12 || b.options.some((o) => typeof o !== 'string' || !o.trim() || o.length > 100)) fail('opções da enquete');
      if (typeof b.multi !== 'boolean') fail('enquete');
      break;
    }
    case 'vote':
      if (!ID.test(m.body?.target ?? '') || !Array.isArray(m.body.choices) || m.body.choices.length > 12 || m.body.choices.some((c) => !Number.isInteger(c) || c < 0 || c > 11)) fail('voto');
      break;
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
