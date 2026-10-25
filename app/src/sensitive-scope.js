// Resultados sensíveis pertencem à sessão e à tela em que começaram.
const scopes = new Set();
let sessionOpen = false;
export function setSensitiveSession(open) {
  sessionOpen = open;
  if (!open) cancelSensitiveOperations();
}
export function cancelSensitiveOperations() {
  for (const scope of [...scopes]) scope.cancel();
}
export function sensitiveScope({ signal, allowed = () => true, transient = true } = {}) {
  const controller = new AbortController();
  const cleanups = new Set();
  const scope = {
    signal: controller.signal, transient,
    valid: () => !controller.signal.aborted && sessionOpen && !globalThis.document?.hidden && allowed(),
    onCancel(fn) { if (controller.signal.aborted) fn(); else cleanups.add(fn); return () => cleanups.delete(fn); },
    cancel() {
      if (controller.signal.aborted) return;
      controller.abort();
      for (const fn of cleanups) { try { fn(); } catch {} }
      scope.finish();
    },
    finish() { scopes.delete(scope); cleanups.clear(); signal?.removeEventListener('abort', abort); },
  };
  const abort = () => scope.cancel();
  scopes.add(scope);
  if (signal?.aborted) scope.cancel(); else signal?.addEventListener('abort', abort, { once: true });
  return scope;
}
if (globalThis.addEventListener) {
  addEventListener('blur', () => { for (const scope of [...scopes]) if (scope.transient) scope.cancel(); });
  addEventListener('pagehide', cancelSensitiveOperations);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelSensitiveOperations(); });
}
