import { test } from 'node:test';
import assert from 'node:assert/strict';

// fitSize é puro; importa só a função, sem carregar a mediabunny no Node.
const src = await (await import('node:fs/promises')).readFile(new URL('../web/compress.js', import.meta.url), 'utf8');
const fitSize = new Function(`${/export function fitSize[\s\S]*?\n}\n/.exec(src)[0].replace('export ', '')}; return fitSize;`)();

test('4K paisagem vira 1080p', () => assert.deepEqual(fitSize(3840, 2160, 1920, 1080), { width: 1920, height: 1080 }));
test('4K retrato vira 1080x1920', () => assert.deepEqual(fitSize(2160, 3840, 1920, 1080), { width: 1080, height: 1920 }));
test('não aumenta vídeo pequeno', () => assert.deepEqual(fitSize(640, 360, 1920, 1080), { width: 640, height: 360 }));
test('lados sempre pares', () => {
  const r = fitSize(1919, 1081, 1280, 720);
  assert.equal(r.width % 2, 0);
  assert.equal(r.height % 2, 0);
});
test('proporção estranha cabe no retângulo', () => {
  const r = fitSize(4000, 1000, 1920, 1080);
  assert.ok(r.width <= 1920 && r.height <= 1080);
});
