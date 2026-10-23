// Web Push SEM conteúdo (RFC 8030 + VAPID RFC 8292). O service worker do app
// mostra sempre "novas mensagens" (V6-021). Sem payload não há o que vazar
// nem o que cifrar; o provedor de push vê só que houve um aviso.
import { b64u } from './http.js';

let keyCache = null;
async function vapidKey(env) {
  if (!env.VAPID_PRIVATE_JWK) throw new Error('VAPID ausente');
  keyCache ??= await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return keyCache;
}

export async function vapidJwt(env, audience, nowSec = Math.floor(Date.now() / 1000)) {
  const enc = (o) => b64u(new TextEncoder().encode(JSON.stringify(o)));
  // `sub` com a URL do app: não expõe e-mail de ninguém.
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud: audience, exp: nowSec + 12 * 3600, sub: env.VAPID_SUBJECT })}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await vapidKey(env), new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64u(sig)}`;
}

export async function sendPush(env, endpoint) {
  const url = new URL(endpoint);
  const jwt = await vapidJwt(env, url.origin);
  return fetch(url, {
    method: 'POST',
    headers: { TTL: '86400', Urgency: 'normal', Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC}`, 'Content-Length': '0' },
  });
}
