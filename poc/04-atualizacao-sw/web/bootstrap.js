// Primeira visita: instala o service worker, que baixa e confere a versão
// inicial. Depois disso quem serve a página é o service worker.
(async () => {
  const status = document.getElementById('status');
  if (!('serviceWorker' in navigator)) { status.textContent = 'Este navegador não tem service worker.'; return; }
  if (navigator.serviceWorker.controller) { location.reload(); return; }
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
  try {
    const reg = await navigator.serviceWorker.register('sw.js', { scope: './', updateViaCache: 'none' });
    const sw = reg.installing || reg.waiting;
    sw?.addEventListener('statechange', () => {
      if (sw.state === 'redundant') status.textContent = 'A versão inicial foi recusada (assinatura ou hash). Nada foi instalado.';
    });
  } catch (e) {
    status.textContent = `Falhou ao instalar: ${e.message || e}`;
  }
})();
