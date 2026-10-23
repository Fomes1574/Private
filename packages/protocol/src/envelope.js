// Conteúdo interno das mensagens (ADR 0003, V7-003, V7-018, V7-021).
// Tudo vai dentro do envelope autenticado; o servidor não vê o tipo.
export const INNER_VERSION = 1;

export const KINDS = new Set([
  'text', 'reaction', 'edit', 'delete_for_all', 'media', 'policy', 'leader_transfer',
  'nickname_change', 'membership', 'unlink',
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
