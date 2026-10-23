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
