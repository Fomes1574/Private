// Trusted Types (V7-017, D-070): com `require-trusted-types-for 'script'`,
// criar Worker ou registrar service worker exige uma URL "confiável". Esta
// política só aceita arquivos da própria origem com nome da lista.
const ALLOWED = new Set(['db-worker.js', 'sw.js']);

const policy = globalThis.trustedTypes?.createPolicy('mp-urls', {
  createScriptURL(u) {
    const url = new URL(u, location.href);
    const name = url.pathname.split('/').pop();
    if (url.origin !== location.origin || !ALLOWED.has(name) || url.search || url.hash) {
      throw new TypeError('URL de script não permitida');
    }
    return url.href;
  },
});

export const scriptURL = (u) => (policy ? policy.createScriptURL(u) : u);
