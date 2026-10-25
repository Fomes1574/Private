import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForPage } from '../../e2e/helpers.mjs';
test('espera assíncrona não aprova Promise que resolve false', async () => {
  let calls = 0;
  await waitForPage({ evaluate: async () => ++calls >= 3 }, () => {}, null, { interval: 1, timeout: 1000 });
  assert.equal(calls, 3);
});
test('condição assíncrona que nunca ocorre reprova por timeout', async () => {
  await assert.rejects(waitForPage({ evaluate: async () => false }, () => {}, null, { interval: 1, timeout: 10 }), /não satisfeita/);
});
