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
