// Copia o bundle oficial da mediabunny para web/vendor e confere SHA-256.
import { createHash } from 'node:crypto';
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';

const src = new URL('./node_modules/mediabunny/', import.meta.url);
const dst = new URL('./web/vendor/', import.meta.url);
const files = [['dist/bundles/mediabunny.min.mjs', 'mediabunny.min.mjs'], ['LICENSE', 'LICENSE-mediabunny.txt']];
const sha = async (u) => createHash('sha256').update(await readFile(u)).digest('hex');
const version = JSON.parse(await readFile(new URL('package.json', src))).version;
const check = process.argv.includes('--check');
await mkdir(dst, { recursive: true });
const lines = [];
for (const [f, name] of files) {
  if (!check) await copyFile(new URL(f, src), new URL(name, dst));
  const a = await sha(new URL(f, src)), b = await sha(new URL(name, dst));
  if (a !== b) { console.error(`${name}: difere do pacote ${version}`); process.exit(1); }
  lines.push(`${b}  ${name}`);
}
const sums = `# mediabunny ${version} (MPL-2.0, arquivos sem modificação)\n${lines.join('\n')}\n`;
if (check) {
  if ((await readFile(new URL('SHA256SUMS', dst), 'utf8')) !== sums) { console.error('SHA256SUMS desatualizado'); process.exit(1); }
  console.log('vendor ok');
} else { await writeFile(new URL('SHA256SUMS', dst), sums); console.log(sums); }
