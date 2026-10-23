// Service worker da Prova 4 (ADR 0006).
// Serve SÓ os arquivos da versão fixada neste aparelho. Versão nova é baixada
// inteira, conferida (assinatura Ed25519 do manifesto + SHA-256 de cada
// arquivo) e fica em espera até a pessoa aceitar vendo o código curto.
'use strict';

const PUBLIC_KEY_B64 = 'Wj4rDkUE7G6mU9xs3zopr/HMDQzDEo4NIvdVRNwYnd0=';
const APP_ID = 'mp-poc4';
const SCOPE = new URL('./', self.location).pathname;

// ---------- estado persistente (IndexedDB) ----------
function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('poc4-sw', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function get(k) {
  const d = await db();
  return new Promise((res, rej) => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
async function put(obj) {
  const d = await db();
  const tx = d.transaction('kv', 'readwrite');
  for (const [k, v] of Object.entries(obj)) tx.objectStore('kv').put(v, k);
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}

// ---------- verificação ----------
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
let pubKey;
async function publicKey() {
  pubKey ??= await crypto.subtle.importKey('raw', unb64(PUBLIC_KEY_B64), { name: 'Ed25519' }, false, ['verify']);
  return pubKey;
}

class Refused extends Error {}

// Baixa o canal, confere tudo e guarda num cache de espera. Nada é ativado aqui.
async function stage(channel) {
  const pointer = await (await fetch(`${SCOPE}channels/${encodeURIComponent(channel)}.json`, { cache: 'no-store' })).json();
  const base = `${SCOPE}releases/${encodeURIComponent(pointer.dir)}/`;
  const manifestBytes = new Uint8Array(await (await fetch(base + 'release.json', { cache: 'no-store' })).arrayBuffer());
  const sig = unb64((await (await fetch(base + 'release.sig', { cache: 'no-store' })).text()).trim());
  const ok = await crypto.subtle.verify({ name: 'Ed25519' }, await publicKey(), sig, manifestBytes);
  if (!ok) throw new Refused('assinatura inválida');
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  if (manifest.app !== APP_ID) throw new Refused(`app errado: ${manifest.app}`);
  const highest = (await get('highest')) ?? 0;
  if (!(manifest.version > highest)) throw new Refused(`downgrade ou repetição: v${manifest.version} ≤ v${highest}`);
  const code = hex(await crypto.subtle.digest('SHA-256', manifestBytes)).slice(0, 8);

  const cacheName = `staged-v${manifest.version}`;
  await caches.delete(cacheName);
  const cache = await caches.open(cacheName);
  for (const [path, expected] of Object.entries(manifest.files)) {
    const resp = await fetch(base + path, { cache: 'no-store' });
    if (!resp.ok) throw new Refused(`arquivo faltando: ${path}`);
    const body = await resp.arrayBuffer();
    const got = hex(await crypto.subtle.digest('SHA-256', body));
    if (got !== expected) { await caches.delete(cacheName); throw new Refused(`hash não confere: ${path}`); }
    await cache.put(new Request(SCOPE + path), new Response(body, { headers: { 'content-type': resp.headers.get('content-type') || 'application/octet-stream' } }));
  }
  const staged = { version: manifest.version, code, cache: cacheName, notes: manifest.notes || '' };
  await put({ staged });
  return staged;
}

// Troca a versão fixada. Só chamado no install inicial ou com aceite da pessoa.
async function apply() {
  const staged = await get('staged');
  if (!staged) throw new Error('nada em espera');
  const pinned = await get('pinned');
  const live = `rel-v${staged.version}`;
  // Copia o cache conferido para o nome definitivo antes de mudar o ponteiro.
  const from = await caches.open(staged.cache), to = await caches.open(live);
  for (const req of await from.keys()) await to.put(req, await from.match(req));
  await put({ pinned: { version: staged.version, code: staged.code, cache: live }, highest: staged.version, staged: null });
  await caches.delete(staged.cache);
  if (pinned && pinned.cache !== live) await caches.delete(pinned.cache);
  return { version: staged.version, code: staged.code };
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    if (!(await get('pinned'))) {
      await stage('inicial');
      await apply();
    }
    // Sem skipWaiting(): um service worker novo só assume quando nenhuma aba
    // da versão anterior estiver aberta (§50.2).
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return;
  const rel = url.pathname.slice(SCOPE.length);
  // Canais e releases só são buscados pelo próprio SW, sempre da rede.
  if (rel.startsWith('channels/') || rel.startsWith('releases/') || rel === 'sw.js') return;
  event.respondWith((async () => {
    const pinned = await get('pinned');
    if (!pinned) return new Response('Versão não instalada.', { status: 503 });
    const cache = await caches.open(pinned.cache);
    const path = event.request.mode === 'navigate' || rel === '' ? 'index.html' : rel;
    // Falha fechada: o que não está na versão fixada não é buscado na rede.
    return (await cache.match(SCOPE + path)) || new Response('Fora da versão fixada.', { status: 404 });
  })());
});

self.addEventListener('message', (event) => {
  const { id, type, channel } = event.data || {};
  const reply = (msg) => event.source.postMessage({ id, ...msg });
  (async () => {
    try {
      if (type === 'status') return reply({ ok: true, pinned: await get('pinned'), staged: await get('staged'), highest: await get('highest') });
      if (type === 'check') return reply({ ok: true, staged: await stage(channel) });
      if (type === 'apply') return reply({ ok: true, applied: await apply() });
      reply({ ok: false, error: 'mensagem desconhecida' });
    } catch (e) {
      reply({ ok: false, refused: e instanceof Refused, error: String(e.message || e) });
    }
  })();
});
