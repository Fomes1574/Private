// Copia o SQLite WASM oficial para web/vendor e grava/confere SHA-256.
// Uso: node vendor.mjs (copiar)  |  node vendor.mjs --check (só conferir)
import { createHash } from 'node:crypto';
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';

const src = new URL('./node_modules/@sqlite.org/sqlite-wasm/', import.meta.url);
const dst = new URL('./web/vendor/sqlite/', import.meta.url);
const files = ['dist/index.mjs', 'dist/sqlite3.wasm'];
const sha = async (u) => createHash('sha256').update(await readFile(u)).digest('hex');

const version = JSON.parse(await readFile(new URL('package.json', src))).version;
const lines = [];
await mkdir(dst, { recursive: true });
for (const f of files) {
  const name = f.split('/').pop();
  if (!process.argv.includes('--check')) await copyFile(new URL(f, src), new URL(name, dst));
  const a = await sha(new URL(f, src)), b = await sha(new URL(name, dst));
  if (a !== b) { console.error(`${name}: cópia difere do pacote ${version}`); process.exit(1); }
  lines.push(`${b}  ${name}`);
}
const sums = `# @sqlite.org/sqlite-wasm ${version}\n${lines.join('\n')}\n`;
if (process.argv.includes('--check')) {
  if ((await readFile(new URL('SHA256SUMS', dst), 'utf8')) !== sums) { console.error('SHA256SUMS desatualizado'); process.exit(1); }
  console.log('vendor ok');
} else {
  await writeFile(new URL('SHA256SUMS', dst), sums);
  console.log(sums);
}
