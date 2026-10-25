// Monta o app em dist/.
//   MP_API=https://api…   origem da API (padrão: http://localhost:8791)
//   MP_MODE=sw|plain      sw: releases assinadas + service worker (PWA);
//                         plain: arquivos soltos (testes e APK do Android)
//   MP_VERSION=<n>        número da versão (inteiro crescente; padrão 1)
//   MP_RELEASE_KEY=<pem>  chave Ed25519 PKCS#8 de assinatura. Sem ela, usa
//                         chave efêmera e marca o build como de desenvolvimento.
import { cp, mkdir, rm, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { createHash, generateKeyPairSync, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { join, relative } from 'node:path';

const here = new URL('./', import.meta.url).pathname;
const repo = join(here, '..');
const dist = join(here, 'dist');
const api = (process.env.MP_API || 'http://localhost:8791').replace(/\/$/, '');
const mode = process.env.MP_MODE || 'sw';
const version = Number(process.env.MP_VERSION || 1);
if (!Number.isSafeInteger(version) || version < 1) throw new Error('MP_VERSION inválido');
const sha = (b) => createHash('sha256').update(b).digest('hex');

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p)); else out.push(p);
  }
  return out;
}

// 1) Arquivos do app, em uma pasta temporária com a árvore final.
const stage = join(dist, '.stage');
await rm(dist, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp(join(here, 'src'), stage, { recursive: true });
for (const [from, to] of [
  ['packages/crypto/index.js', 'packages/crypto/index.js'],
  ['packages/crypto/pkg', 'packages/crypto/pkg'],
  ['packages/protocol/src', 'packages/protocol/src'],
  ['packages/client/src', 'packages/client/src'],
  ['poc/03-banco-local-cifrado/web/vendor/sqlite', 'vendor/sqlite'],
  // Vídeo (Prova 6): mesmo código de compressão e a mediabunny conferida.
  ['poc/06-video-safari/web/compress.js', 'video/compress.js'],
  ['poc/06-video-safari/web/vendor', 'video/vendor'],
]) await cp(join(repo, from), join(stage, to), { recursive: true });
await cp(join(repo, 'branding/pacto-talk-icon-180.png'), join(stage, 'icon-180.png'));
await cp(join(repo, 'branding/pacto-talk-icon-512.webp'), join(stage, 'icon-512.webp'));

// Cópia de terceiros precisa bater com o SHA256SUMS conferido no CI.
for (const dir of ['vendor/sqlite', 'video/vendor', 'vendor/pdfjs', 'vendor/qrcode']) {
  const sums = (await readFile(join(stage, dir, 'SHA256SUMS'), 'utf8')).split('\n').filter((l) => /^[0-9a-f]{64}/.test(l));
  if (!sums.length) throw new Error(`${dir}: SHA256SUMS vazio`);
  for (const l of sums) {
    const [h, name] = l.split(/\s+/);
    if (sha(await readFile(join(stage, dir, name))) !== h) throw new Error(`${dir} alterado: ${name}`);
  }
}

// QR (S8): o arquivo original, conferido acima, vira módulo sem ser alterado.
await writeFile(join(stage, 'vendor/qrcode/qrcode.mjs'), `${await readFile(join(stage, 'vendor/qrcode/qrcode.js'), 'utf8')}\nexport default qrcode;\n`);

// 2) Assinatura.
let priv, devBuild = false;
if (process.env.MP_RELEASE_KEY) priv = createPrivateKey(process.env.MP_RELEASE_KEY);
else { priv = generateKeyPairSync('ed25519').privateKey; devBuild = true; }
const pubB64 = createPublicKey(priv).export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');

// 3) Manifesto do app e configuração.
const manifest = {
  id: '/', name: 'Pacto Talk', short_name: 'Pacto Talk', start_url: './', scope: './', display: 'standalone',
  background_color: '#0B1220', theme_color: '#0B1220',
  icons: [{ src: 'icon-180.png', sizes: '180x180', type: 'image/png' }, { src: 'icon-512.webp', sizes: '512x512', type: 'image/webp' }],
};
await writeFile(join(stage, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));

// O código curto depende do conteúdo; config.js entra com um marcador e o
// código real é calculado sobre os outros arquivos.
const files = (await walk(stage)).filter((f) => !f.endsWith('/config.js'));
const contentHash = sha(Buffer.concat(await Promise.all(files.sort().map(async (f) => Buffer.from(relative(stage, f) + '\0' + sha(await readFile(f)))))));
const versionCode = `${version}-${contentHash.slice(0, 8)}${devBuild ? '-dev' : ''}`;
await writeFile(join(stage, 'config.js'), `// Gerado pelo build. Não editar.
export const CONFIG = Object.freeze(${JSON.stringify({ api, version, versionCode, serviceWorker: mode === 'sw', devBuild, testHooks: process.env.MP_TEST_HOOKS === '1' && mode === 'plain' })});
`);

// 4) Saída.
const connect = `'self' ${api} ${api.replace(/^http/, 'ws')}`;
// worker-src blob: e a política TT "default" existem só para os Workers
// internos da mediabunny (ver src/tt.js).
const csp = ["default-src 'none'", "script-src 'self' 'wasm-unsafe-eval'", "worker-src 'self' blob:", `connect-src ${connect}`,
  "style-src 'self'", "img-src 'self' blob:", "media-src 'self' blob:", "manifest-src 'self'", "base-uri 'none'", "form-action 'none'",
  "frame-ancestors 'none'", "object-src 'none'", "require-trusted-types-for 'script'", 'trusted-types mp-urls default'].join('; ');
const headers = ['/*', `  Content-Security-Policy: ${csp}`, '  X-Content-Type-Options: nosniff', '  Referrer-Policy: no-referrer',
  '  Cross-Origin-Opener-Policy: same-origin', '  Cross-Origin-Embedder-Policy: require-corp', '  Cross-Origin-Resource-Policy: same-origin',
  '  Permissions-Policy: geolocation=(), microphone=(self), camera=(self), payment=(), usb=()',
  '  Strict-Transport-Security: max-age=31536000; includeSubDomains', '  Cache-Control: no-cache', ''].join('\n');

if (mode === 'plain') {
  await cp(stage, dist, { recursive: true });
  // No APK não há servidor para mandar cabeçalhos: a CSP vai no próprio HTML
  // (frame-ancestors não vale em <meta> e o WebView não abre em iframe).
  if (process.env.MP_CSP_META) {
    const metaCsp = csp.replace("; frame-ancestors 'none'", '');
    const idx = join(dist, 'index.html');
    await writeFile(idx, (await readFile(idx, 'utf8')).replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${metaCsp}">`));
  }
} else {
  // Release imutável: dist/releases/v<n>/… + manifesto assinado + SW.
  const rel = join(dist, 'releases', `v${version}`);
  await cp(stage, rel, { recursive: true });
  const relFiles = (await walk(rel)).sort();
  const releaseManifest = { app: 'mp-app', version, versionCode, files: {} };
  for (const f of relFiles) releaseManifest.files[relative(rel, f)] = sha(await readFile(f));
  const bytes = Buffer.from(JSON.stringify(releaseManifest, null, 2) + '\n');
  await writeFile(join(rel, 'release.json'), bytes);
  await writeFile(join(rel, 'release.sig'), sign(null, bytes, priv).toString('base64') + '\n');
  await mkdir(join(dist, 'channels'), { recursive: true });
  await writeFile(join(dist, 'channels', 'estavel.json'), JSON.stringify({ dir: `v${version}` }) + '\n');
  const sw = (await readFile(join(here, 'sw/sw.js'), 'utf8')).replace('__PUBLIC_KEY__', pubB64);
  await writeFile(join(dist, 'sw.js'), sw);
  // Primeira visita: a mesma página da release, que registra o SW e recarrega.
  for (const f of ['index.html', 'styles.css', 'manifest.webmanifest', 'icon-180.png', 'icon-512.webp']) await cp(join(stage, f), join(dist, f));
  await cp(join(here, 'sw/bootstrap.js'), join(dist, 'bootstrap.js'));
  const boot = (await readFile(join(dist, 'index.html'), 'utf8')).replace('<script type="module" src="main.js"></script>', '<script src="bootstrap.js"></script>');
  await writeFile(join(dist, 'index.html'), boot);
  await writeFile(join(dist, 'RELEASE'), `versão ${version}\ncódigo ${sha(bytes).slice(0, 8)}\nchave pública ${pubB64}\n${devBuild ? 'BUILD DE DESENVOLVIMENTO (chave efêmera)\n' : ''}`);
}
await writeFile(join(dist, '_headers'), headers);
await rm(stage, { recursive: true, force: true });
console.log(`app ${mode} v${version} (${versionCode}) → dist/  api=${api}${devBuild ? '  [chave efêmera: build de desenvolvimento]' : ''}`);
