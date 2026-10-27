import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readJson } from '../src/http.js';

const request = (body, headers) => new Request('https://local.invalid/', { method: 'POST', body, headers, duplex: 'half' });
const error = (status, code) => (e) => e.status === status && e.code === code;

test('JSON: interrompe e cancela o fluxo no primeiro excesso, sem consumir o restante', async () => {
  let reads = 0, cancelled = false;
  const stream = new ReadableStream({
    pull(c) { reads++; c.enqueue(new Uint8Array(512).fill(32)); if (reads === 1000) c.close(); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  await assert.rejects(readJson(request(stream), 1024), error(413, 'too_large'));
  assert.equal(reads, 3); assert.equal(cancelled, true);
});

test('JSON: o limite é em bytes UTF-8, não em caracteres nem no Content-Length declarado', async () => {
  const body = JSON.stringify({ text: 'á'.repeat(8) });
  assert.ok(body.length < 30); assert.ok(Buffer.byteLength(body) > 25);
  await assert.rejects(readJson(request(body, { 'content-length': '1' }), 25), error(413, 'too_large'));
  assert.deepEqual(await readJson(request(body), Buffer.byteLength(body)), { text: 'á'.repeat(8) });
});

test('JSON: tamanho declarado excessivo cancela sem ler; UTF-8 dividido entre chunks continua válido', async () => {
  let reads = 0, cancelled = false;
  const stream = new ReadableStream({ pull() { reads++; }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  await assert.rejects(readJson(request(stream, { 'content-length': '2048' }), 1024), error(413, 'too_large'));
  assert.equal(reads, 0); assert.equal(cancelled, true);
  const encoded = new TextEncoder().encode('{"text":"á😀"}'); let i = 0;
  const pieces = new ReadableStream({ pull(c) { if (i === encoded.length) c.close(); else c.enqueue(encoded.slice(i, ++i)); } });
  assert.deepEqual(await readJson(request(pieces)), { text: 'á😀' });
});

test('JSON: entrada vazia, truncada, UTF-8 inválido e valores sem objeto dão 400', async () => {
  for (const body of ['', '{', 'null', '1', '[]', '"a"', new Uint8Array([0xff])]) {
    await assert.rejects(readJson(request(body)), error(400, 'bad_json'));
  }
});

test('JSON: envio que nunca termina é cancelado pelo prazo total de leitura', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  const result = assert.rejects(readJson(request(stream)), error(408, 'request_timeout'));
  t.mock.timers.tick(15_000);
  await result;
  assert.equal(cancelled, true);
});
