// VAPID (RFC 8292): JWT ES256 assinado e verificável com a chave pública.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vapidJwt } from '../src/push.js';

test('JWT do VAPID: ES256, aud do serviço de push, sub sem e-mail, expira em 12 h', async () => {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const env = { VAPID_PRIVATE_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', kp.privateKey)), VAPID_SUBJECT: 'https://app.exemplo' };
  const jwt = await vapidJwt(env, 'https://web.push.apple.com', 1_000_000);
  const [h, p, s] = jwt.split('.');
  const dec = (x) => JSON.parse(Buffer.from(x, 'base64url').toString());
  assert.deepEqual(dec(h), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(dec(p), { aud: 'https://web.push.apple.com', exp: 1_000_000 + 12 * 3600, sub: 'https://app.exemplo' });
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, Buffer.from(s, 'base64url'), new TextEncoder().encode(`${h}.${p}`));
  assert.equal(ok, true);
});
