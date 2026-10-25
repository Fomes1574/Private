// Regressão: APK do Capacitor (https://localhost) e PWA devem atravessar
// CORS sem abrir a API para outras origens. Exercita o Worker REAL via workerd.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi } from './helpers.mjs';

const APP = 'https://mp-app.pactoapps.workers.dev';
const APK = 'https://localhost';
let api;
before(async () => { api = await startApi(8812, { appOrigin: APP }); });
after(() => api?.stop());

function preflight(origin, path = '/v1/bootstrap') {
  return fetch(api.base + path, {
    method: 'OPTIONS',
    headers: {
      origin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    },
  });
}
test('preflight permite a PWA e o APK Android, mas não outras origens', async () => {
  for (const origin of [APP, APK]) {
    for (const path of ['/v1/bootstrap', '/v1/vault/release', '/v1/auth/session']) {
      const r = await preflight(origin, path);
      assert.equal(r.status, 204, origin + path);
      assert.equal(r.headers.get('access-control-allow-origin'), origin);
      assert.match(r.headers.get('access-control-allow-methods') ?? '', /POST/);
      assert.match(r.headers.get('access-control-allow-headers') ?? '', /content-type/);
      assert.match(r.headers.get('vary') ?? '', /origin/i);
      assert.equal(r.headers.get('access-control-allow-credentials'), null);
    }
  }
  for (const origin of ['http://localhost', 'https://localhost.evil.example', 'https://evil.example', 'null', APP + '.evil.test']) {
    const r = await preflight(origin);
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('access-control-allow-origin'), null, origin);
  }
});

test('resposta real tem o mesmo CORS e relógio confiável; origem estranha não lê', async () => {
  for (const origin of [APP, APK]) {
    const r = await fetch(api.base + '/v1/time', { headers: { origin } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), origin);
    assert.match(r.headers.get('access-control-expose-headers') ?? '', /retry-after/i);
    assert.ok(Number(r.headers.get('x-mp-time')) > 1_000_000_000_000);
    const data = await r.json();
    assert.ok(Number(data.now) > 1_000_000_000_000);
    const unauthorized = await fetch(api.base + '/v1/directory', { headers: { origin } });
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get('access-control-allow-origin'), origin);
  }
  const r = await fetch(api.base + '/v1/time', { headers: { origin: 'https://evil.example' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), null);
});
