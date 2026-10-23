import * as store from './store.js';

const $ = (s) => document.querySelector(s);
const diag = { events: [] };
const ROOM = 'sala-teste';
// Nesta prova o "agora" é o relógio da página. No app real vem do servidor
// (§10): o relógio do aparelho nunca decide prazo.
const trustedNow = () => Date.now();

const worker = new Worker('./db-worker.js', { type: 'module' });
let seq = 0;
const pending = new Map();
worker.onmessage = ({ data }) => {
  const p = pending.get(data.id);
  pending.delete(data.id);
  data.ok ? p.resolve(data.result) : p.reject(new Error(data.error));
};
worker.onerror = (e) => fail(e.message || 'erro no worker');
const call = (op, arg) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  worker.postMessage({ id, op, arg });
});

function show(t) { $('#status').textContent = t; }
function log(t) { diag.events.push(`${new Date().toISOString().slice(11, 19)} ${t}`); render(); }
function render() { $('#diag').textContent = JSON.stringify(diag, null, 2); }
function fail(e) { show(`Falhou: ${e.message || e}`); log(`erro: ${e.message || e}`); }

// Chave do banco. Aqui é uma CryptoKey não extraível guardada no IndexedDB;
// no app real ela vem do cofre da prova 2 (Face ID + PIN).
async function loadKey() {
  let { dek } = await store.getAll(['dek']);
  if (!dek) {
    dek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await store.putAll({ dek });
    log('chave nova gerada');
  }
  return dek;
}

async function refresh() {
  const list = $('#list');
  list.replaceChildren();
  try {
    const r = await call('list', { room: ROOM, nowMs: trustedNow() });
    diag.lastList = { shown: r.messages.length, purgedBeforeRender: r.purged, ms: r.ms };
    for (const m of r.messages) {
      const li = document.createElement('li');
      li.textContent = m.text ?? '(ilegível: chave errada ou adulterada)';
      if (!m.text) li.className = 'err';
      list.append(li);
    }
  } catch (e) {
    diag.lastList = { error: e.message };
  }
  diag.db = await call('info'); // depois da lista, que já apagou as vencidas
  render();
}

async function act(label, fn) {
  try { show(`${label}…`); const r = await fn(); log(`${label}: ${JSON.stringify(r)}`); show(`${label}: pronto.`); await refresh(); }
  catch (e) { fail(e); }
}

async function start() {
  diag.userAgent = navigator.userAgent;
  diag.standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  diag.opfs = !!navigator.storage?.getDirectory;
  try { diag.persist = await navigator.storage?.persist?.(); } catch (e) { diag.persist = String(e); }
  const { opens = 0 } = await store.getAll(['opens']);
  diag.opens = opens + 1;
  await store.putAll({ opens: diag.opens });

  const t0 = performance.now();
  await call('setKey', await loadKey());
  diag.openMs = +(performance.now() - t0).toFixed(0);
  try {
    const est = await navigator.storage?.estimate?.();
    if (est) diag.storage = { usageKB: Math.round(est.usage / 1024), quotaMB: Math.round(est.quota / 1048576) };
  } catch {}

  $('#fill').onclick = () => act('Gravar 1.000', () => call('fill', { n: 1000, room: ROOM, ttlMs: 5 * 86400_000, nowMs: trustedNow() }));
  $('#fill10').onclick = () => act('Gravar 10.000', () => call('fill', { n: 10000, room: ROOM, ttlMs: 5 * 86400_000, nowMs: trustedNow() }));
  $('#short').onclick = () => act('Gravar 5 que vencem em 30 s', () => call('fill', { n: 5, room: ROOM, ttlMs: 30_000, nowMs: trustedNow() }));
  $('#reload').onclick = () => act('Reler', async () => true);
  $('#shred').onclick = () => act('Destruir a chave', async () => {
    await store.putAll({ dek: undefined });
    await call('setKey', await loadKey()); // chave nova: o que estava gravado vira ilegível
    return 'chave antiga destruída';
  });
  $('#wipe').onclick = () => act('Apagar o banco', () => call('wipe'));
  $('#copy').onclick = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify({ ...diag, at: new Date().toISOString() }, null, 2)); show('Relatório copiado.'); }
    catch { show('Não deu para copiar: selecione o diagnóstico na mão.'); }
  };
  $('#app').hidden = false;
  show(`Pronto · abertura nº ${diag.opens}`);
  await refresh();
}

start().catch(fail);
