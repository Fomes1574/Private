// Mídia cifrada em segmentos (§14, §51): chave aleatória por arquivo (CEK),
// AES-256-GCM por segmento com nonce = prefixo aleatório ‖ índice, e AAD que
// marca o último segmento. Reordenar, cortar ou emendar segmentos falha.
export const MEDIA_FORMAT_V = 1;
export const SEGMENT = 64 * 1024;
const TAG = 16;
const MAGIC = [0x4d, 0x50, 0x4d, MEDIA_FORMAT_V]; // "MPM" + versão

function nonce(prefix, index) {
  const n = new Uint8Array(12);
  n.set(prefix, 0);
  new DataView(n.buffer).setUint32(8, index);
  return n;
}
const aad = (index, last) => new TextEncoder().encode(`mp/media/v${MEDIA_FORMAT_V}/${index}/${last ? 1 : 0}`);

export async function newMediaKey() {
  return crypto.getRandomValues(new Uint8Array(32));
}

export async function encryptMedia(rawKey, bytes) {
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
  const prefix = crypto.getRandomValues(new Uint8Array(8));
  const count = Math.max(1, Math.ceil(bytes.byteLength / SEGMENT));
  const out = new Uint8Array(4 + 8 + 4 + bytes.byteLength + count * TAG);
  out.set(MAGIC, 0);
  out.set(prefix, 4);
  new DataView(out.buffer).setUint32(12, count);
  let off = 16;
  for (let i = 0; i < count; i++) {
    const seg = bytes.subarray(i * SEGMENT, Math.min(bytes.byteLength, (i + 1) * SEGMENT));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce(prefix, i), additionalData: aad(i, i === count - 1) }, key, seg));
    out.set(ct, off);
    off += ct.byteLength;
  }
  return out;
}

export async function decryptMedia(rawKey, blob) {
  if (blob.byteLength < 16 || MAGIC.some((b, i) => blob[i] !== b)) throw new Error('formato de mídia desconhecido');
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
    const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce(prefix, i), additionalData: aad(i, i === count - 1) }, key, ct));
    out.set(pt, pos);
    pos += pt.byteLength;
    off += ct.byteLength;
  }
  if (off !== blob.byteLength) throw new Error('mídia com bytes a mais');
  return out;
}
