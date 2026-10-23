// Trusted Types (V7-017). A mediabunny cria Workers a partir de URLs blob:
// internamente, e seus arquivos não podem ser alterados (MPL + hash
// conferido). A política "default" aceita SÓ blob: da própria origem: quem
// consegue criar esse blob já executa código aqui, então não abre porta nova.
// Qualquer outra URL de script, HTML ou script em texto continua bloqueado.
const origin = location.origin;
globalThis.trustedTypes?.createPolicy('default', {
  createScriptURL(u) {
    if (typeof u === 'string' && u.startsWith(`blob:${origin}/`)) return u;
    throw new TypeError('URL de script não permitida');
  },
});
