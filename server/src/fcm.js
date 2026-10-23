// Aviso para o APK Android pelo FCM (HTTP v1). A mensagem vai VAZIA de
// propósito (V6-021, D-028): sem texto, sem conversa, sem remetente, sem id
// de mensagem, sem contagem. O único campo de dados é uma constante, porque
// o FCM exige algum conteúdo. Quem desenha "novas mensagens" é o próprio app
// (NovasMensagensService). O Google vê só que o app recebeu um aviso e quando.
import { b64u } from './http.js';

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const FCM_API = 'https://fcm.googleapis.com';
// Endereços trocáveis só para os testes locais (servidor falso em 127.0.0.1).
const LOCAL = /^http:\/\/127\.0\.0\.1:\d{2,5}$/;

// Token de registro do FCM: base64url com ":" e "-"; sem espaço nem URL.
export const FCM_TOKEN_RE = /^[A-Za-z0-9_:-]{100,4096}$/;

let cache = null; // { raw, sa, key, access, exp }

async function account(env) {
  const raw = env.FCM_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FCM ausente');
  if (cache?.raw === raw) return cache;
  const sa = JSON.parse(raw);
  if (sa.type !== 'service_account' || !sa.client_email || !sa.private_key || !/^[a-z0-9-]{4,40}$/.test(sa.project_id ?? '')) throw new Error('conta de serviço inválida');
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const tokenUri = sa.token_uri === TOKEN_URI || LOCAL.test(new URL(sa.token_uri ?? TOKEN_URI).origin) ? (sa.token_uri ?? TOKEN_URI) : TOKEN_URI;
  cache = { raw, sa, key, tokenUri, access: null, exp: 0 };
  return cache;
}

// JWT RS256 da conta de serviço (RFC 7523), trocado por um token de acesso de 1 h.
export async function serviceJwt(acc, nowSec = Math.floor(Date.now() / 1000)) {
  const enc = (o) => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT', kid: acc.sa.private_key_id })}.${enc({ iss: acc.sa.client_email, scope: SCOPE, aud: acc.tokenUri, iat: nowSec, exp: nowSec + 3600 })}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', acc.key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64u(sig)}`;
}

async function accessToken(acc) {
  if (acc.access && Date.now() < acc.exp - 300_000) return acc.access;
  const r = await fetch(acc.tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: await serviceJwt(acc) }),
  });
  if (!r.ok) throw new Error(`oauth ${r.status}`);
  const j = await r.json();
  acc.access = j.access_token;
  acc.exp = Date.now() + (Number(j.expires_in) || 3600) * 1000;
  return acc.access;
}

// A mensagem exata que sai daqui. Exportada para o teste conferir que não há
// nada além disto.
export const fcmMessage = (token) => ({
  message: {
    token,
    data: { v: '1' },
    android: { priority: 'HIGH', ttl: '86400s', collapse_key: 'mp' },
  },
});

// Resultado: { ok } ou { gone } quando o token não vale mais (app apagado,
// token trocado ou de outro projeto). Outros erros não apagam nada.
export async function sendFcm(env, token) {
  const acc = await account(env);
  const api = LOCAL.test(env.FCM_API_BASE ?? '') ? env.FCM_API_BASE : FCM_API;
  const send = async () => fetch(`${api}/v1/projects/${acc.sa.project_id}/messages:send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await accessToken(acc)}`, 'content-type': 'application/json' },
    body: JSON.stringify(fcmMessage(token)),
  });
  let r = await send();
  if (r.status === 401) { acc.access = null; r = await send(); }
  if (r.ok) return { ok: true };
  let code = '';
  try { code = (await r.json())?.error?.details?.find((d) => d.errorCode)?.errorCode ?? ''; } catch {}
  if (r.status === 404 || code === 'UNREGISTERED' || code === 'SENDER_ID_MISMATCH') return { gone: true };
  return { ok: false, status: r.status };
}
