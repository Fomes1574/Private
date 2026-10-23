import * as olm from './olm.js';
import * as store from './store.js';
import { runSelfTest, benchFanout } from './selftest.js';

const $ = (s) => document.querySelector(s);
const STATE_KEYS = ['pickleKey', 'alice', 'bob', 'aliceSession', 'bobSession', 'queue', 'opens', 'createdAt', 'ids'];

const diag = {};
const peers = { alice: {}, bob: {} };
let pickleKey;
let queue = [];
let lastSelfTest = null;

function show(text) { $('#status').textContent = text; }

function logLine(who, cls, text, cipher) {
  const li = document.createElement('li');
  li.className = cls;
  li.textContent = text;
  if (cipher) {
    const s = document.createElement('small');
    s.textContent = cipher;
    li.append(s);
  }
  const ol = document.querySelector(`[data-who=${who}] .log`);
  ol.append(li);
  ol.scrollTop = ol.scrollHeight;
}

function cipherHint(env) {
  return `v${env.v} t${env.t} ${env.body.slice(0, 24)}… (${olm.unb64(env.body).length} B)`;
}

function renderDiag() {
  $('#diag').textContent = JSON.stringify(diag, null, 2);
  $('#queued').textContent = queue.length;
  $('#deliver').hidden = queue.length === 0;
  document.querySelector('[data-who=bob] form button').disabled = !peers.bob.session;
}

// Grava o estado das duas pessoas e a fila numa transação só.
async function persist() {
  await store.putAll({
    alice: peers.alice.account.pickle(pickleKey),
    bob: peers.bob.account.pickle(pickleKey),
    aliceSession: peers.alice.session?.pickle(pickleKey),
    bobSession: peers.bob.session?.pickle(pickleKey),
    queue,
  });
}

async function createFresh() {
  pickleKey = crypto.getRandomValues(new Uint8Array(32));
  peers.alice.account = new olm.OlmAccount();
  peers.bob.account = new olm.OlmAccount();
  peers.alice.session = olm.startSession(peers.alice.account, peers.bob.account);
  peers.bob.session = null;
  queue = [];
  const ids = { alice: peers.alice.account.curve25519Key, bob: peers.bob.account.curve25519Key };
  await store.putAll({ pickleKey, createdAt: new Date().toISOString(), opens: 0, ids });
  await persist();
  return ids;
}

async function restore(s) {
  pickleKey = s.pickleKey;
  peers.alice.account = olm.OlmAccount.fromPickle(s.alice, pickleKey);
  peers.bob.account = olm.OlmAccount.fromPickle(s.bob, pickleKey);
  peers.alice.session = s.aliceSession ? olm.OlmSession.fromPickle(s.aliceSession, pickleKey) : null;
  peers.bob.session = s.bobSession ? olm.OlmSession.fromPickle(s.bobSession, pickleKey) : null;
  queue = s.queue || [];
}

const other = (who) => (who === 'alice' ? 'bob' : 'alice');
const name = (who) => (who === 'alice' ? 'Alice' : 'Bob');

async function send(from, text) {
  const env = olm.seal(peers[from].session, text);
  queue.push({ from, to: other(from), env });
  await persist(); // ratchet avançou: salva antes de "enviar"
  logLine(from, 'me', text, cipherHint(env));
  if (!(other(from) === 'bob' && $('#bobOffline').checked)) await deliver();
  renderDiag();
}

async function deliver() {
  while (queue.length) {
    const { from, to, env } = queue[0];
    try {
      let text;
      if (!peers[to].session) {
        const r = olm.openFirst(peers[to].account, peers[from].account.curve25519Key, env);
        peers[to].session = r.session;
        text = r.text;
      } else {
        text = olm.open(peers[to].session, env);
      }
      logLine(to, '', text, cipherHint(env));
    } catch (e) {
      logLine(to, 'sys err', `falha ao decifrar: ${e.message || e}`);
    }
    queue.shift();
    await persist(); // estado do destinatário e fila mudam juntos
  }
  renderDiag();
}

async function storageInfo() {
  const out = {};
  // Pede para o navegador não apagar os dados por falta de espaço ou desuso.
  try { out.persistRequest = await navigator.storage?.persist?.(); } catch (e) { out.persistRequest = String(e); }
  try { out.persisted = await navigator.storage?.persisted?.(); } catch (e) { out.persisted = String(e); }
  try {
    const est = await navigator.storage?.estimate?.();
    if (est) out.usageKB = Math.round(est.usage / 1024), out.quotaMB = Math.round(est.quota / 1048576);
  } catch (e) { out.estimate = String(e); }
  return out;
}

async function start() {
  diag.userAgent = navigator.userAgent;
  diag.standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  diag.secureContext = isSecureContext;
  diag.webLocks = 'locks' in navigator;

  const t0 = performance.now();
  await olm.loadWasm(globalThis.__POC_WASM__);
  diag.wasmLoadMs = +(performance.now() - t0).toFixed(1);
  diag.library = olm.vodozemacVersion();

  const s = await store.getAll(STATE_KEYS);
  const t1 = performance.now();
  if (s.alice) {
    await restore(s);
    diag.restoreMs = +(performance.now() - t1).toFixed(1);
    const same = s.ids.alice === peers.alice.account.curve25519Key && s.ids.bob === peers.bob.account.curve25519Key;
    diag.identitiesSameAsFirstOpen = same;
    diag.createdAt = s.createdAt;
    diag.opens = (s.opens || 0) + 1;
    logLine('alice', 'sys', `Estado restaurado (abertura nº ${diag.opens}). Histórico em texto não é salvo.`);
    logLine('bob', 'sys', `Estado restaurado. ${queue.length} mensagem(ns) na fila.`);
  } else {
    const ids = await createFresh();
    diag.createdAt = new Date().toISOString();
    diag.opens = 1;
    diag.identitiesSameAsFirstOpen = true;
    logLine('alice', 'sys', `Identidade nova: ${ids.alice.slice(0, 12)}…`);
    logLine('bob', 'sys', `Identidade nova: ${ids.bob.slice(0, 12)}… Bob responde depois da primeira mensagem da Alice.`);
  }
  await store.putAll({ opens: diag.opens });
  diag.identity = { alice: peers.alice.account.curve25519Key.slice(0, 16), bob: peers.bob.account.curve25519Key.slice(0, 16) };
  diag.storage = await storageInfo();

  for (const who of ['alice', 'bob']) {
    document.querySelector(`[data-who=${who}] form`).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const input = ev.target.elements.text;
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      try { await send(who, text); } catch (e) { logLine(who, 'sys err', `erro: ${e.message || e}`); }
    });
  }
  $('#deliver').addEventListener('click', () => deliver());
  $('#bobOffline').addEventListener('change', (e) => { if (!e.target.checked) deliver(); });

  $('#selftest').addEventListener('click', async () => {
    show('Rodando testes…');
    const results = await runSelfTest();
    const bench = benchFanout();
    lastSelfTest = { results, fanout: bench };
    diag.selfTest = `${results.filter((r) => r.ok).length}/${results.length} ok`;
    diag.selfTestFailures = results.filter((r) => !r.ok);
    diag.fanoutMs = bench;
    show(`Testes: ${diag.selfTest}`);
    renderDiag();
  });

  $('#copy').addEventListener('click', async () => {
    const report = JSON.stringify({ ...diag, selfTestDetail: lastSelfTest, at: new Date().toISOString() }, null, 2);
    try { await navigator.clipboard.writeText(report); show('Relatório copiado.'); } catch { show('Não deu para copiar: selecione o diagnóstico na mão.'); }
  });

  // Confirmação dentro da página: confirm() não aparece em todo lugar.
  let armed = false;
  $('#reset').addEventListener('click', async (ev) => {
    if (!armed) {
      armed = true;
      ev.target.textContent = 'Toque de novo para apagar tudo';
      setTimeout(() => { armed = false; ev.target.textContent = 'Apagar tudo e recomeçar'; }, 4000);
      return;
    }
    await store.clearAll();
    location.reload();
  });

  $('#app').hidden = false;
  show(`Pronto · ${diag.library} · WASM em ${diag.wasmLoadMs} ms`);
  renderDiag();
}

// Uma instância por aparelho (V7-013): segunda aba não mexe no estado.
function main() {
  if (!('locks' in navigator)) return start().catch(fail);
  navigator.locks.request('poc1-instance', { ifAvailable: true }, (lock) => {
    if (!lock) { show('O app já está aberto em outra aba ou janela.'); return; }
    start().catch(fail);
    return new Promise(() => {}); // segura a trava enquanto a página viver
  });
}

function fail(e) {
  show(`Falhou: ${e.message || e}`);
  console.error(e);
}

main();
