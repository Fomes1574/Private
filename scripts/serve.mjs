// Servidor local das provas: /poc1/ → poc/01-*/web, /poc2/ → poc/02-*/web, ...
// Só para desenvolvimento (http://localhost:8080). Em produção quem serve é o Worker.
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const repo = new URL('..', import.meta.url).pathname;
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.json': 'application/json',
};
const roots = {};
for (const d of await readdir(join(repo, 'poc'))) {
  const m = /^(\d\d)-/.exec(d);
  if (m) roots[`poc${Number(m[1])}`] = join(repo, 'poc', d, 'web');
}
const port = Number(process.env.PORT || 8080);

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const [, name, ...rest] = path.split('/');
  const root = roots[name];
  if (!root) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(Object.keys(roots).map((k) => `<p><a href="/${k}/">${k}</a></p>`).join(''));
    return;
  }
  let rel = rest.join('/');
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const file = join(root, rel);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': types[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp',
      'x-content-type-options': 'nosniff',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, () => console.log(`http://localhost:${port}/`));
