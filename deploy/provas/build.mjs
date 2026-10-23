// Monta dist/ com as seis provas sob /poc1/ … /poc6/ e um _headers com a CSP
// de cada uma. Quem serve é o Worker da Prova 5 (rotas /v1/*).
import { cp, mkdir, rm, writeFile, readdir } from 'node:fs/promises';

const repo = new URL('../../', import.meta.url);
const dist = new URL('./dist/', import.meta.url);
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const pocs = (await readdir(new URL('poc/', repo))).filter((d) => /^\d\d-/.test(d)).sort();
for (const d of pocs) {
  const n = Number(d.slice(0, 2));
  await cp(new URL(`poc/${d}/web/`, repo), new URL(`poc${n}/`, dist), {
    recursive: true,
    filter: (src) => !src.endsWith('/_headers'),
  });
}

const base = ["default-src 'none'", "connect-src 'self'", "style-src 'self'", "img-src 'self'", "manifest-src 'self'",
  "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'", "object-src 'none'", "require-trusted-types-for 'script'",
  "trusted-types 'none'"];
const csp = (extra) => {
  const map = new Map(base.map((d) => [d.split(' ')[0], d]));
  for (const d of extra) map.set(d.split(' ')[0], d);
  return [...map.values()].join('; ');
};
const perPoc = {
  1: ["script-src 'self' 'wasm-unsafe-eval'"],
  2: ["script-src 'self' 'wasm-unsafe-eval'"],
  3: ["script-src 'self' 'wasm-unsafe-eval'", "worker-src 'self'", 'trusted-types mp-urls'],
  4: ["script-src 'self'", "worker-src 'self'", 'trusted-types mp-urls'],
  5: ["script-src 'self'", "img-src 'self' blob:"],
  6: ["script-src 'self'", "worker-src 'self' blob:", "media-src 'self' blob:", 'trusted-types default'],
};

const lines = [
  '/*',
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: no-referrer',
  '  Cross-Origin-Opener-Policy: same-origin',
  '  Cross-Origin-Embedder-Policy: require-corp',
  '  Cross-Origin-Resource-Policy: same-origin',
  '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  '  Strict-Transport-Security: max-age=31536000; includeSubDomains',
  '  Cache-Control: no-cache',
  '',
  '/',
  `  Content-Security-Policy: ${csp(["script-src 'none'"])}`,
  '',
];
for (const [n, extra] of Object.entries(perPoc)) lines.push(`/poc${n}/*`, `  Content-Security-Policy: ${csp(extra)}`, '');
await writeFile(new URL('_headers', dist), lines.join('\n'));

const items = pocs.map((d) => `<li><a href="/poc${Number(d.slice(0, 2))}/">Prova ${Number(d.slice(0, 2))} · ${d.slice(3).replaceAll('-', ' ')}</a></li>`).join('\n');
await writeFile(new URL('index.html', dist), `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Provas de conceito</title>
<link rel="stylesheet" href="/poc1/style.css"></head>
<body><header><h1>Provas de conceito</h1><p id="status">Abra cada prova e siga “Como testar”.</p></header>
<main><ul>
${items}
</ul></main></body></html>
`);
console.log(`dist/ com ${pocs.length} provas`);
