// Mede o app (núcleo do cliente) com a rede de um 4G, de uma VPN e do Tor.
// Cada pedido paga a ida e volta (RTT) e o tempo de transmissão na banda
// limitada. Conta quantos pedidos cada ação faz e quanto tempo leva.
// Uso: node scripts/medir-rede.mjs   (sobe a API local sozinho)
import { readFile } from 'node:fs/promises';
import { startApi, SETUP } from '../server/test/helpers.mjs';
import { loadCrypto } from '../packages/crypto/index.js';
import { TrustedClock } from '../packages/protocol/src/time.js';
import { MessengerClient, Api, MemoryStore } from '../packages/client/src/index.js';

await loadCrypto(await readFile(new URL('../packages/crypto/pkg/mp_crypto_bg.wasm', import.meta.url)));
const PERFIS = {
  '4G direto': { rtt: 60, mbps: 20 },
  'VPN boa': { rtt: 140, mbps: 15 },
  'Tor (Orbot)': { rtt: 800, mbps: 2 },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let net = { rtt: 0, mbps: 1e6 }, count = 0;
const tx = (bytes) => (bytes * 8) / (net.mbps * 1e6) * 1000;
async function slowFetch(url, opts = {}) {
  count++;
  const up = opts.body ? (opts.body.byteLength ?? opts.body.length ?? 0) : 0;
  await sleep(net.rtt / 2 + tx(up));
  const res = await fetch(url, opts);
  const buf = await res.arrayBuffer();
  await sleep(net.rtt / 2 + tx(buf.byteLength));
  return new Response(buf, { status: res.status, headers: res.headers });
}
const api = await startApi(8799);
const mk = () => new MessengerClient({ api: new Api(api.base, new TrustedClock(), { fetchImpl: slowFetch }), store: new MemoryStore(), pickleKey: crypto.getRandomValues(new Uint8Array(32)) });
const ana = mk(), bia = mk();
await ana.bootstrap(SETUP); await ana.login();
const { token } = await ana.api.post('/v1/invites', {});
await bia.redeem(token); await bia.login();
await ana.refreshDirectory(); await bia.refreshDirectory();
const room = (await ana.createRoom('direct', [bia.userId])).roomId;
await bia.sync(); await bia.sendText(room, 'oi'); await ana.sync();

const photo = crypto.getRandomValues(new Uint8Array(65536)); const big = new Uint8Array(400_000); for (let i = 0; i < big.length; i += 65536) big.set(photo.subarray(0, Math.min(65536, big.length - i)), i);
async function medir(nome, fn) {
  count = 0; const t = performance.now(); await fn();
  return { nome, ms: Math.round(performance.now() - t), pedidos: count };
}
const linhas = [];
for (const [perfil, p] of Object.entries(PERFIS)) {
  net = p;
  const r = [];
  r.push(await medir('enviar texto', () => ana.sendText(room, 'teste de rede')));
  // receber = aviso pelo WebSocket (meia ida) + sincronizar
  r.push(await medir('receber texto', async () => { await sleep(p.rtt / 2); await bia.sync(); }));
  let m;
  r.push(await medir('enviar foto 400 KB', async () => { m = await ana.sendMedia(room, big, { mime: 'image/jpeg' }); }));
  await bia.sync();
  const got = await bia.store.getMessage(m.msgId);
  r.push(await medir('abrir foto 400 KB', () => bia.openMedia(got)));
  linhas.push([perfil, r]);
}
for (const [perfil, r] of linhas) console.log(`\n${perfil}\n` + r.map((x) => `  ${x.nome.padEnd(22)} ${String(x.ms).padStart(6)} ms  (${x.pedidos} pedidos)`).join('\n'));
api.stop();
process.exit(0);
