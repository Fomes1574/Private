import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as p from '../src/index.js';

test('prazo: 12 h a 15 dias, padrão 5 dias, sem "Nunca"', () => {
  assert.equal(p.DEFAULT_TTL, 5 * 86400);
  assert.ok(p.isValidTtl(12 * 3600));
  assert.ok(p.isValidTtl(15 * 86400));
  for (const bad of [12 * 3600 - 1, 15 * 86400 + 1, 0, -1, Infinity, null, 4 * 3600, 30 * 86400, 1.5 * 86400 + 0.5]) assert.equal(p.isValidTtl(bad), false, String(bad));
  assert.ok(p.TTL_OPTIONS.every(p.isValidTtl));
});

test('vencimento conta do aceite do servidor; "dia" = 24 h', () => {
  const accepted = Date.UTC(2026, 9, 23, 13, 0); // 10:00 em Brasília
  const exp = p.expiresAt(accepted, 12 * 3600);
  assert.equal(p.formatTime(accepted), '10:00');
  assert.equal(p.formatTime(exp), '22:00'); // exemplo da §10.1
  assert.equal(p.expiresAt(accepted, 86400) - accepted, 86_400_000);
});

test('sem tempo confiável conta como vencido (falha fechada)', () => {
  assert.equal(p.isExpired(Date.now() + 1e9, null), true);
  assert.equal(p.isExpired(1000, 999), false);
  assert.equal(p.isExpired(1000, 1000), true);
});

test('Brasília mesmo com o processo em outro fuso', () => {
  const ms = Date.UTC(2026, 0, 1, 2, 30); // 23:30 do dia anterior em Brasília
  assert.equal(p.formatDateTime(ms), '31/12/2025, 23:30');
});

test('relógio confiável: usa o servidor e expira a amostra', () => {
  let mono = 0;
  const c = new p.TrustedClock({ monotonic: () => mono, maxAgeMs: 60_000 });
  assert.equal(c.now(), null);
  c.update(1_000_000, 200);
  assert.equal(c.now(), 1_000_100);
  mono = 30_000;
  assert.equal(c.now(), 1_030_100, 'avança pelo relógio monotônico, não pelo relógio do aparelho');
  mono = 61_000;
  assert.equal(c.now(), null, 'amostra velha: precisa falar com o servidor');
  c.update(2_000_000);
  mono = 50_000; // monotônico voltou (reinício): invalida
  assert.equal(c.now(), null);
});
