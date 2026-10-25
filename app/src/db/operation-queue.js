// Uma operação SQLite por vez, inclusive entre awaits de WebCrypto.
// Entre rebuild e switchTo, as chamadas comuns aguardam a decisão do cofre.
export function operationQueue(ops, respond) {
  let tail = Promise.resolve(), prepared = false;
  const waiting = [];
  const controls = new Set(['switchTo', 'abortRebuild', 'lock', 'wipe']);
  const failWaiting = () => { for (const data of waiting.splice(0)) respond({ id: data.id, ok: false, error: 'operação cancelada pelo bloqueio' }); };
  async function execute(data) {
    const { id, op, arg } = data;
    if (prepared && !controls.has(op)) { waiting.push(data); return; }
    try {
      if (!Object.hasOwn(ops, op) || typeof ops[op] !== 'function') throw new Error('operação inválida');
      if ((op === 'lock' || op === 'wipe') && prepared) {
        await ops.abortRebuild(); prepared = false; failWaiting();
      }
      const result = await ops[op](arg);
      if (op === 'rebuild') prepared = true;
      if (op === 'switchTo' || op === 'abortRebuild') {
        prepared = false;
        // Mantém a ordem de chegada sem travar switchTo atrás de uma escrita.
        for (const deferred of waiting.splice(0)) await execute(deferred);
      }
      respond({ id, ok: true, result });
    } catch (e) { respond({ id, ok: false, error: String(e?.message || e) }); }
  }
  return (data) => { tail = tail.then(() => execute(data), () => execute(data)); return tail; };
}
