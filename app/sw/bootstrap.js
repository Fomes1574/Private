// Primeira visita ao app: instala o service worker, que baixa a release,
// confere assinatura e hashes e passa a servir o app. Depois recarrega.
const ttPolicy = globalThis.trustedTypes?.createPolicy('mp-urls', {
  createScriptURL(u) {
    const url = new URL(u, location.href);
    if (url.origin !== location.origin || url.pathname.split('/').pop() !== 'sw.js' || url.search || url.hash) throw new TypeError('URL de script não permitida');
    return url.href;
  },
});
(async () => {
  const root = document.getElementById('root');
  const say = (t) => { const p = document.createElement('p'); p.className = 'muted'; p.textContent = t; root.replaceChildren(p); };
  if (!('serviceWorker' in navigator)) return say('Este navegador não oferece o necessário para o app.');
  if (navigator.serviceWorker.controller) return location.reload();
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
  say('Instalando e conferindo a assinatura do app…');
  try {
    const reg = await navigator.serviceWorker.register(ttPolicy ? ttPolicy.createScriptURL('sw.js') : 'sw.js', { scope: './', updateViaCache: 'none' });
    const sw = reg.installing || reg.waiting;
    sw?.addEventListener('statechange', () => { if (sw.state === 'redundant') say('A versão do app foi recusada (assinatura ou conteúdo não conferem). Nada foi instalado.'); });
  } catch (e) { say(`Não deu para instalar: ${e.message}`); }
})();
