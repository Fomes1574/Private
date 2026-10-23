// Trusted Types (V7-017): só scripts da própria origem com nome conhecido
// viram Worker ou service worker.
const ALLOWED = new Set(['db-worker.js', 'sw.js']);
const policy = globalThis.trustedTypes?.createPolicy('mp-urls', {
  createScriptURL(u) {
    const url = new URL(u, location.href);
    if (url.origin !== location.origin || !ALLOWED.has(url.pathname.split('/').pop()) || url.search || url.hash) throw new TypeError('URL de script não permitida');
    return url.href;
  },
});
export const scriptURL = (u) => (policy ? policy.createScriptURL(u) : u);

// A mediabunny (vídeo) cria Workers a partir de URLs blob: internamente e
// seus arquivos não podem ser alterados (MPL + hash conferido). A política
// "default" aceita SÓ blob: da própria origem: quem consegue criar esse blob
// já executa código aqui, então não abre porta nova. HTML e script em texto
// continuam bloqueados (a política não define createHTML/createScript).
const origin = location.origin;
globalThis.trustedTypes?.createPolicy('default', {
  createScriptURL(u) {
    if (typeof u === 'string' && u.startsWith(`blob:${origin}/`)) return u;
    throw new TypeError('URL de script não permitida');
  },
});
