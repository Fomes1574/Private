import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptMedia, decryptMedia, newMediaKey, SEGMENT } from '../src/media-crypto.js';

const rnd = (n) => { const b = new Uint8Array(n); for (let i = 0; i < n; i += 65536) crypto.getRandomValues(b.subarray(i, Math.min(n, i + 65536))); return b; };

test('ida e volta em vários tamanhos (vazio, 1 segmento, exato, vários)', async () => {
  for (const n of [0, 10, SEGMENT, SEGMENT + 1, 5 * SEGMENT + 123]) {
    const k = await newMediaKey(), data = rnd(n);
    assert.deepEqual(await decryptMedia(k, await encryptMedia(k, data)), data, `n=${n}`);
  }
});

test('cortar, trocar a ordem, emendar ou mudar 1 bit falha', async () => {
  const k = await newMediaKey(), data = rnd(3 * SEGMENT + 10);
  const blob = await encryptMedia(k, data);
  const seg = SEGMENT + 16;
  await assert.rejects(decryptMedia(k, blob.subarray(0, blob.byteLength - 100)), 'truncado');
  await assert.rejects(decryptMedia(k, blob.subarray(0, 16 + 2 * seg)), 'último segmento removido');
  const swapped = blob.slice();
  swapped.set(blob.subarray(16 + seg, 16 + 2 * seg), 16);
  swapped.set(blob.subarray(16, 16 + seg), 16 + seg);
  await assert.rejects(decryptMedia(k, swapped), 'ordem trocada');
  const flip = blob.slice(); flip[100] ^= 1;
  await assert.rejects(decryptMedia(k, flip));
  await assert.rejects(decryptMedia(await newMediaKey(), blob), 'outra chave');
  const extra = new Uint8Array(blob.byteLength + 5); extra.set(blob);
  await assert.rejects(decryptMedia(k, extra), 'bytes a mais');
});

test('S7: versão com degrau esconde o tamanho exato e abre igual', async () => {
  const { encryptMedia, decryptMedia, newMediaKey, paddedSize } = await import('../src/media-crypto.js');
  const key = await newMediaKey();
  for (const n of [0, 1, 5000, 70_000, 300_001]) {
    const data = rnd(n);
    const blob = await encryptMedia(key, data, { pad: true });
    assert.equal(blob[3], 2);
    const plainLen = paddedSize(8 + n);
    assert.equal(blob.byteLength, 16 + plainLen + Math.ceil(plainLen / 65536) * 16, 'só o degrau aparece');
    assert.deepEqual(await decryptMedia(key, blob), data);
  }
  const a = await encryptMedia(key, new Uint8Array(10_000), { pad: true });
  const b = await encryptMedia(key, new Uint8Array(40_000), { pad: true });
  assert.equal(a.byteLength, b.byteLength, 'tamanhos diferentes caem no mesmo degrau');
  assert.ok(paddedSize(95 * 2 ** 20) <= 100 * 2 ** 20, 'vídeo máximo cabe no limite do servidor');
});
