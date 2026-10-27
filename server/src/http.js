// Utilidades HTTP comuns. Erros têm código fixo e nunca ecoam a entrada (ADR 0008).
export const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-site',
};

export class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

export const json = (status, body, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...SECURITY_HEADERS, ...extra } });

export const fail = (status, code) => json(status, { error: code });

export async function readJson(request, maxBytes = 64 * 1024) {
  const len = Number(request.headers.get('content-length') || 0);
  const reader = request.body?.getReader();
  let timer;
  try {
    if (len > maxBytes) throw new HttpError(413, 'too_large');
    if (!reader) throw new HttpError(400, 'bad_json');
    // O cabeçalho pode faltar ou mentir. Conte bytes ANTES de decodificar e
    // interrompa a leitura no primeiro excesso, inclusive em envio em partes.
    let bytes = 0, text = '';
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new HttpError(408, 'request_timeout')), 15_000);
    });
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new HttpError(413, 'too_large');
      try { text += decoder.decode(value, { stream: true }); }
      catch { throw new HttpError(400, 'bad_json'); }
    }
    try {
      const body = JSON.parse(text + decoder.decode());
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('object required');
      return body;
    } catch { throw new HttpError(400, 'bad_json'); }
  } catch (error) {
    // Não esperar cancel(): uma origem que não fecha o envio não deve
    // manter a resposta de erro nem o Worker presos.
    if (reader) void reader.cancel().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    reader?.releaseLock();
  }
}

export const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
export const unb64 = (s) => {
  try { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); } catch { throw new HttpError(400, 'bad_base64'); }
};
export const b64u = (bytes) => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const randomId = (n = 16) => b64u(crypto.getRandomValues(new Uint8Array(n)));

export async function sha256b64(text) {
  return b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

// Comparação sem atalho por tempo.
export function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
export function assertId(v, code = 'bad_id') { if (typeof v !== 'string' || !ID_RE.test(v)) throw new HttpError(400, code); return v; }

// Resultado de um Durable Object: { error } vira HttpError.
const STATUS = {
  unauthorized: 401, forbidden: 403, not_found: 404, gone: 404, used: 410, revoked: 410, expired: 410,
  circle_full: 409, exists: 409, conflict: 409, bad_state: 409, not_ready: 409, frozen: 423, too_early: 425,
  rate_limited: 429, storage_full: 507, bad_request: 400, same_as_pin: 409, vault_required: 409,
};
export function unwrap(r) {
  if (r && r.error) throw new HttpError(STATUS[r.error] ?? 400, r.error);
  return r;
}
