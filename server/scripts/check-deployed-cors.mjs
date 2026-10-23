// Teste pós-publicação: não cria contas, não precisa de segredo e não exibe
// informação de usuários. Falha o deploy se a origem do APK não funcionar.
import assert from 'node:assert/strict';

const api = (process.env.API_ORIGIN || '').replace(/\/$/, '');
const app = (process.env.APP_ORIGIN || '').replace(/\/$/, '');
if (!/^https:\/\/[^/]+$/.test(api) || !/^https:\/\/[^/]+$/.test(app)) {
  throw new Error('Configure API_ORIGIN e APP_ORIGIN com URLs HTTPS sem caminho');
}
const origins = [app, 'https://localhost'];

for (const origin of origins) {
  for (const path of ['/v1/bootstrap', '/v1/vault/release']) {
    const r = await fetch(api + path, {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(r.status, 204, 'Preflight ' + origin + path);
    assert.equal(r.headers.get('access-control-allow-origin'), origin, 'CORS ' + origin + path);
    assert.match(r.headers.get('access-control-allow-methods') || '', /POST/);
    assert.match(r.headers.get('access-control-allow-headers') || '', /content-type/);
    assert.match(r.headers.get('vary') || '', /origin/i);
  }
  const r = await fetch(api + '/v1/time', {
    headers: { origin },
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), origin);
  assert.ok(Number(r.headers.get('x-mp-time')) > 1_000_000_000_000);
}

for (const origin of ['https://evil.example', 'https://localhost.evil.example', 'http://localhost']) {
  const r = await fetch(api + '/v1/bootstrap', {
    method: 'OPTIONS',
    headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(r.headers.get('access-control-allow-origin'), null, 'Origem desconhecida foi autorizada: ' + origin);
}
console.log('OK: PWA e APK Android autorizados; outras origens bloqueadas; API responde.');
