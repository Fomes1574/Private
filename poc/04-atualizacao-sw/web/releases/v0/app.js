// App de teste da Prova 4. O mesmo arquivo vira v1 e v2 no build.
'use strict';
const VERSION = Number('0');
const $ = (s) => document.querySelector(s);
const diag = { appVersion: VERSION, events: [] };

function show(t) { $('#status').textContent = t; }
function log(t) { diag.events.push(`${new Date().toISOString().slice(11, 19)} ${t}`); render(); }
function render() { $('#diag').textContent = JSON.stringify(diag, null, 2); }
const fmtCode = (c) => (c ? `${c.slice(0, 4)} ${c.slice(4, 8)}` : '—');

let seq = 0;
function ask(msg) {
  return new Promise((resolve) => {
    const id = ++seq;
    const on = (ev) => { if (ev.data?.id === id) { navigator.serviceWorker.removeEventListener('message', on); resolve(ev.data); } };
    navigator.serviceWorker.addEventListener('message', on);
    navigator.serviceWorker.controller.postMessage({ id, ...msg });
  });
}

// Dados locais que precisam sobreviver à atualização: identidade e banco.
function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('poc4-app', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function kv(mode, fn) {
  const d = await openDb();
  const tx = d.transaction('kv', mode);
  const out = fn(tx.objectStore('kv'));
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
  return out;
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

async function localState() {
  let ident;
  await kv('readonly', (st) => req(st.get('identity')).then((v) => { ident = v; }));
  if (!ident) {
    const key = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', key.publicKey));
    const fp = [...new Uint8Array(await crypto.subtle.digest('SHA-256', pub))].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
    ident = { key, fingerprint: fp, createdInVersion: VERSION };
    await kv('readwrite', (st) => { st.put(ident, 'identity'); st.put(1, 'schema'); });
    log('identidade nova criada');
  }
  // A chave privada continua utilizável após a atualização (não extraível).
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, ident.key.privateKey, new Uint8Array([1, 2, 3]));
  diag.identityWorks = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, ident.key.publicKey, sig, new Uint8Array([1, 2, 3]));

  // Migração v1 → v2 numa transação só: ou tudo, ou nada.
  let schema;
  await kv('readonly', (st) => req(st.get('schema')).then((v) => { schema = v; }));
  if (VERSION >= 2 && schema < 2) {
    await kv('readwrite', (st) => { st.put({ migratedAt: new Date().toISOString(), from: schema }, 'migration'); st.put(2, 'schema'); });
    schema = 2;
    log('banco migrado 1 → 2');
  }
  diag.identity = ident.fingerprint;
  diag.identityCreatedInVersion = ident.createdInVersion;
  diag.schema = schema;
  $('#identity').textContent = `${ident.fingerprint} (criada na v${ident.createdInVersion})`;
  $('#schema').textContent = String(schema);
}

async function refreshStatus() {
  const s = await ask({ type: 'status' });
  diag.pinned = s.pinned;
  diag.highestAccepted = s.highest;
  $('#pinned').textContent = s.pinned ? `v${s.pinned.version}` : '—';
  $('#code').textContent = fmtCode(s.pinned?.code);
  render();
}

async function start() {
  diag.userAgent = navigator.userAgent;
  diag.standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  diag.online = navigator.onLine;
  if (!navigator.serviceWorker?.controller) { show('Sem service worker no controle: recarregue.'); return; }
  await localState();
  await refreshStatus();

  $('#check').onclick = async () => {
    $('#offer').hidden = true;
    const channel = $('#channel').value;
    show('Baixando e conferindo…');
    const r = await ask({ type: 'check', channel });
    if (!r.ok) {
      log(`canal ${channel}: ${r.refused ? 'RECUSADA' : 'erro'} (${r.error})`);
      show(r.refused ? `Atualização recusada: ${r.error}.` : `Erro: ${r.error}`);
      return;
    }
    log(`canal ${channel}: v${r.staged.version} conferida, código ${r.staged.code}`);
    $('#offerVer').textContent = r.staged.version;
    $('#offerCode').textContent = fmtCode(r.staged.code);
    $('#offer').hidden = false;
    show('Atualização conferida e pronta. Nada muda até você aceitar.');
  };
  $('#later').onclick = () => { $('#offer').hidden = true; show('Continua na versão atual.'); };
  $('#apply').onclick = async () => {
    const r = await ask({ type: 'apply' });
    if (!r.ok) { show(`Erro: ${r.error}`); return; }
    location.reload();
  };
  $('#copy').onclick = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify({ ...diag, at: new Date().toISOString() }, null, 2)); show('Relatório copiado.'); }
    catch { show('Não deu para copiar: selecione o diagnóstico na mão.'); }
  };
  show(`Rodando a versão ${VERSION} servida pelo service worker.`);
  render();
}

start().catch((e) => { show(`Falhou: ${e.message || e}`); console.error(e); });
