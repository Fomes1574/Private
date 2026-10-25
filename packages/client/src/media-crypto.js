// Mídia cifrada em segmentos (§14, §51): chave aleatória por arquivo (CEK),
// AES-256-GCM por segmento com nonce = prefixo aleatório ‖ índice, e AAD que
// marca o último segmento. Reordenar, cortar ou emendar segmentos falha.
//
// Versão 2 (S7): o conteúdo vai com o tamanho real (8 bytes) na frente e
// zeros até um degrau, então o servidor só vê em que degrau o arquivo cai,
// não o tamanho exato. Degrau = múltiplo de max(64 KiB, 1/8 da potência de 2
// abaixo do tamanho): no máximo ~12,5% a mais. A versão 1 continua abrindo.
export const MEDIA_FORMAT_V = 1;
export const SEGMENT = 64 * 1024;
const TAG = 16;
const MAGIC_BASE = [0x4d, 0x50, 0x4d]; // "MPM" + versão
const LEN = 8;
export function paddedSize(n) {
  const step = Math.max(64 * 1024, 2 ** Math.floor(Math.log2(Math.max(1, n))) / 8);
  return Math.ceil(n / step) * step;
}

function nonce(prefix, index) {
  const n = new Uint8Array(12);
  n.set(prefix, 0);
  new DataView(n.buffer).setUint32(8, index);
  return n;
}
const aad = (v, index, last) => new TextEncoder().encode(`mp/media/v${v}/${index}/${last ? 1 : 0}`);

export async function newMediaKey() {
  return crypto.getRandomValues(new Uint8Array(32));
}

export async function encryptMedia(rawKey, bytes, { pad = false } = {}) {
  const v = pad ? 2 : 1;
  if (pad) {
    // Preenchido com zeros até o degrau; o tamanho real vai cifrado na frente.
    const total = paddedSize(LEN + bytes.byteLength);
    const p = new Uint8Array(total);
    new DataView(p.buffer).setBigUint64(0, BigInt(bytes.byteLength));
    p.set(bytes, LEN);
    try { return await encryptRaw(rawKey, p, 2); } finally { p.fill(0); }
  }
  return encryptRaw(rawKey, bytes, v);
}
async function encryptRaw(rawKey, bytes, v) {
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
  const prefix = crypto.getRandomValues(new Uint8Array(8));
  const count = Math.max(1, Math.ceil(bytes.byteLength / SEGMENT));
  const out = new Uint8Array(4 + 8 + 4 + bytes.byteLength + count * TAG);
  out.set([...MAGIC_BASE, v], 0);
  out.set(prefix, 4);
  new DataView(out.buffer).setUint32(12, count);
  let off = 16;
  for (let i = 0; i < count; i++) {
    const seg = bytes.subarray(i * SEGMENT, Math.min(bytes.byteLength, (i + 1) * SEGMENT));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce(prefix, i), additionalData: aad(v, i, i === count - 1) }, key, seg));
    out.set(ct, off);
    off += ct.byteLength;
  }
  return out;
}

export async function decryptMedia(rawKey, blob) {
  if (blob.byteLength < 16 || MAGIC_BASE.some((b, i) => blob[i] !== b) || ![1, 2].includes(blob[3])) throw new Error('formato de mídia desconhecido');
  const v = blob[3];
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
  const prefix = blob.subarray(4, 12);
  const count = new DataView(blob.buffer, blob.byteOffset).getUint32(12);
  const plainLen = blob.byteLength - 16 - count * TAG;
  if (count < 1 || plainLen < 0 || Math.ceil(plainLen / SEGMENT) > count || (plainLen > 0 && Math.ceil(plainLen / SEGMENT) !== count)) throw new Error('mídia truncada ou adulterada');
  const out = new Uint8Array(plainLen);
  let off = 16, pos = 0;
  for (let i = 0; i < count; i++) {
    const segLen = Math.min(SEGMENT, plainLen - pos);
    const ct = blob.subarray(off, off + segLen + TAG);
    const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce(prefix, i), additionalData: aad(v, i, i === count - 1) }, key, ct));
    out.set(pt, pos);
    pos += pt.byteLength;
    off += ct.byteLength;
  }
  if (off !== blob.byteLength) throw new Error('mídia com bytes a mais');
  if (v === 1) return out;
  // v2: tamanho real na frente; o resto precisa ser só zeros.
  const real = Number(new DataView(out.buffer).getBigUint64(0));
  if (real > out.byteLength - LEN) { out.fill(0); throw new Error('mídia adulterada'); }
  for (let i = LEN + real; i < out.byteLength; i++) if (out[i] !== 0) { out.fill(0); throw new Error('preenchimento adulterado'); }
  const res = out.slice(LEN, LEN + real);
  out.fill(0);
  return res;
}
