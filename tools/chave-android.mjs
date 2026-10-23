// Roda o MESMO código da página gerar-chave-android.html (bloco cert-lib),
// fora do navegador. Uso no CI: assinar um APK de release DE TESTE com uma
// chave descartável e provar que o apksigner aceita o que a página gera.
// Nunca use para a chave de verdade: essa nasce no navegador do proprietário.
//   node tools/chave-android.mjs <pasta>  →  key.der, cert.pem, sha256.txt
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

export async function makeAndroidKey(now) {
  const html = readFileSync(new URL('./gerar-chave-android.html', import.meta.url), 'utf8');
  const lib = /<script id="cert-lib">([\s\S]*?)<\/script>/.exec(html)[1];
  const ctx = vm.createContext({ crypto: globalThis.crypto, btoa, TextEncoder, Date, Uint8Array, String, parseInt, Promise });
  vm.runInContext(lib, ctx);
  return ctx.makeAndroidKey(now);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const dir = process.argv[2];
  if (!dir) { console.error('uso: node tools/chave-android.mjs <pasta>'); process.exit(2); }
  const k = await makeAndroidKey();
  writeFileSync(join(dir, 'key.der'), Buffer.from(k.key, 'base64'), { mode: 0o600 });
  writeFileSync(join(dir, 'cert.pem'), k.cert);
  writeFileSync(join(dir, 'sha256.txt'), `${k.fp}\n`);
}
