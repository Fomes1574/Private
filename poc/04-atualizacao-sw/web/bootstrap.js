// Primeira visita: instala o service worker, que baixa e confere a versão
// inicial. Depois disso quem serve a página é o service worker.
// Trusted Types (V7-017): registrar o service worker exige URL confiável.
const ttPolicy = globalThis.trustedTypes?.createPolicy('mp-urls', {
  createScriptURL(u) {
    const url = new URL(u, location.href);
    if (url.origin !== location.origin || url.pathname.split('/').pop() !== 'sw.js' || url.search || url.hash) throw new TypeError('URL de script não permitida');
    return url.href;
  },
});
const scriptURL = (u) => (ttPolicy ? ttPolicy.createScriptURL(u) : u);

(async () => {
  const status = document.getElementById('status');
  if (!('serviceWorker' in navigator)) { status.textContent = 'Este navegador não tem service worker.'; return; }
  if (navigator.serviceWorker.controller) { location.reload(); return; }
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
  try {
    const reg = await navigator.serviceWorker.register(scriptURL('sw.js'), { scope: './', updateViaCache: 'none' });
    const sw = reg.installing || reg.waiting;
    sw?.addEventListener('statechange', () => {
      if (sw.state === 'redundant') status.textContent = 'A versão inicial foi recusada (assinatura ou hash). Nada foi instalado.';
    });
  } catch (e) {
    status.textContent = `Falhou ao instalar: ${e.message || e}`;
  }
})();
