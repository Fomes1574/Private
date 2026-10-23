// Gera as releases assinadas da Prova 4.
//
// A chave de assinatura desta prova é EFÊMERA: criada aqui, usada e
// descartada. Só a chave pública vai para o sw.js. No app real a chave
// privada fica fora da Cloudflare e fora do repositório (ADR 0006).
//
// Canais de teste:
//   inicial    → v1 (o que o service worker instala na primeira visita)
//   estavel    → v2 legítima
//   adulterada → v3 com um arquivo trocado depois de assinar
//   assinatura → v3 assinada por outra chave
//   downgrade  → v0 assinada corretamente, mas mais antiga
//   repetida   → v1 de novo
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rm, copyFile } from 'node:fs/promises';

const here = (p) => new URL(p, import.meta.url);
const out = here('./web/');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return { privateKey, publicB64: raw.toString('base64') };
}

const trusted = keypair();
const rogue = keypair();

const manifestJson = await readFile(here('../01-vodozemac-wasm/web/manifest.webmanifest'), 'utf8');
const webmanifest = manifestJson.replace('"/poc1/"', '"/poc4/"').replace('Prova 1 vodozemac', 'Prova 4 atualização').replace('"Prova 1"', '"Prova 4"');
const icons = { 'icon-180.png': await readFile(here('../01-vodozemac-wasm/web/icon-180.png')), 'icon-512.png': await readFile(here('../01-vodozemac-wasm/web/icon-512.png')) };

async function appFiles(version, notes) {
  const fill = (s) => s.replaceAll('{{VERSION}}', String(version)).replaceAll('{{NOTES}}', notes);
  return {
    'index.html': Buffer.from(fill(await readFile(here('./src/app/index.html'), 'utf8'))),
    'app.js': Buffer.from(fill(await readFile(here('./src/app/app.js'), 'utf8'))),
    'style.css': await readFile(here('./src/app/style.css')),
    'manifest.webmanifest': Buffer.from(webmanifest),
    ...icons,
  };
}

const codes = [];
async function release(dir, version, notes, { key = trusted, tamper = null } = {}) {
  const files = await appFiles(version, notes);
  const manifest = {
    app: 'mp-poc4',
    version,
    notes,
    files: Object.fromEntries(Object.entries(files).map(([p, b]) => [p, sha256(b)])),
  };
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  const sig = sign(null, bytes, key.privateKey).toString('base64');
  if (tamper) files[tamper.file] = Buffer.from(tamper.content);
  const d = new URL(`releases/${dir}/`, out);
  await mkdir(d, { recursive: true });
  for (const [p, b] of Object.entries(files)) await writeFile(new URL(p, d), b);
  await writeFile(new URL('release.json', d), bytes);
  await writeFile(new URL('release.sig', d), sig + '\n');
  codes.push({ dir, version, code: sha256(bytes).slice(0, 8), note: key === trusted && !tamper ? 'legítima' : 'teste de recusa' });
}

await rm(out, { recursive: true, force: true });
await mkdir(new URL('channels/', out), { recursive: true });
await release('v0', 0, 'Versão antiga (para testar downgrade).');
await release('v1', 1, 'Versão 1.');
await release('v2', 2, 'Versão 2: migra o banco local para o esquema 2.');
await release('v3-adulterada', 3, 'Versão 3 adulterada.', { tamper: { file: 'app.js', content: 'alert("código trocado")' } });
await release('v3-outra-chave', 3, 'Versão 3 assinada por outra chave.', { key: rogue });

const channels = { inicial: 'v1', estavel: 'v2', adulterada: 'v3-adulterada', assinatura: 'v3-outra-chave', downgrade: 'v0', repetida: 'v1' };
for (const [c, dir] of Object.entries(channels)) await writeFile(new URL(`channels/${c}.json`, out), JSON.stringify({ dir }) + '\n');

const sw = (await readFile(here('./src/sw.js'), 'utf8')).replace('__PUBLIC_KEY__', trusted.publicB64).replace("stage('estavel')", "stage('inicial')");
await writeFile(new URL('sw.js', out), sw);
await writeFile(new URL('index.html', out), await readFile(here('./src/bootstrap.html')));
await writeFile(new URL('bootstrap.js', out), await readFile(here('./src/bootstrap.js')));
await writeFile(new URL('bootstrap.css', out), await readFile(here('./src/bootstrap.css')));
await writeFile(new URL('manifest.webmanifest', out), webmanifest);
for (const [n, b] of Object.entries(icons)) await writeFile(new URL(n, out), b);

// Hashes publicados FORA da Cloudflare (este arquivo vive no GitHub).
const md = ['# Releases da Prova 4', '', `Chave pública Ed25519: \`${trusted.publicB64}\``, '',
  '| Pasta | Versão | Código | Tipo |', '|---|---|---|---|',
  ...codes.map((c) => `| ${c.dir} | ${c.version} | \`${c.code.slice(0, 4)} ${c.code.slice(4)}\` | ${c.note} |`), ''];
await writeFile(here('./RELEASES.md'), md.join('\n'));
console.log(md.join('\n'));
