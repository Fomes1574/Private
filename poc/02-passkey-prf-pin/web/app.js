import * as vault from './vault.js';
import * as store from './store.js';
import * as passkey from './passkey.js';

const $ = (s) => document.querySelector(s);
const diag = { events: [] };
let dek = null; // só existe enquanto desbloqueado

const vaultStore = {
  load: async () => (await store.getAll(['vault'])).vault ?? null,
  save: (r) => store.putAll({ vault: r }),
};

function show(text) { $('#status').textContent = text; }
function log(ev) { diag.events.push(`${new Date().toISOString().slice(11, 19)} ${ev}`); render(); }
function render() { $('#diag').textContent = JSON.stringify(diag, null, 2); }

function view(name) {
  for (const id of ['setup', 'locked', 'unlocked']) $('#' + id).hidden = id !== name;
}

const errText = (e) => (e && e.name === 'NotAllowedError' ? 'Face ID cancelado ou negado.' : e?.message || String(e));

async function timed(label, fn) {
  const t0 = performance.now();
  try { return await fn(); } finally { diag[label] = +(performance.now() - t0).toFixed(0); }
}

function lock(reason) {
  if (!dek) return;
  dek = null; // a CryptoKey não extraível some com a última referência
  $('#noteShown').textContent = '';
  $('#note').value = '';
  view('locked');
  log(`bloqueado (${reason})`);
}

async function showUnlocked() {
  view('unlocked');
  const { note } = await store.getAll(['note']);
  $('#noteShown').textContent = note ? await vault.unseal(dek, note) : '(nenhuma)';
}

async function refreshLocked() {
  const rec = await vaultStore.load();
  if (!rec) { view('setup'); return; }
  if (!rec.wrapped) {
    view('locked');
    $('#attempts').textContent = 'Cofre destruído por excesso de tentativas. Apague e recomece.';
    return;
  }
  $('#unlockLabel').textContent = rec.mode === 'passkey' ? 'PIN' : 'Frase-senha';
  $('#unlockSecret').inputMode = rec.mode === 'passkey' ? 'numeric' : 'text';
  $('#attempts').textContent = rec.failures ? `${rec.failures} de ${vault.MAX_FAILURES} tentativas erradas.` : '';
  view('locked');
}

async function create(ev) {
  ev.preventDefault();
  const mode = $('#mode').value;
  const s1 = $('#secret1').value, s2 = $('#secret2').value;
  const problem = mode === 'passkey' ? vault.checkPin(s1) : vault.checkPassphrase(s1);
  if (problem) return show(problem);
  if (s1 !== s2) return show('Os dois campos não são iguais.');
  try {
    let prf = null, credentialId = null, prfSalt = null;
    if (mode === 'passkey') {
      prfSalt = vault.random(32);
      const reg = await timed('registerMs', () => passkey.register(prfSalt));
      diag.prfEnabledAtCreate = reg.prfEnabled;
      diag.prfReturnedAtCreate = !!reg.prf;
      credentialId = reg.credentialId;
      prf = reg.prf ?? await timed('firstGetMs', () => passkey.evaluate(credentialId, prfSalt));
      prfSalt = vault.b64(prfSalt);
    }
    const res = await timed('createVaultMs', () => vault.createVault({ mode, prf, secret: s1, credentialId, prfSalt }));
    prf?.fill(0);
    await vaultStore.save(res.record);
    dek = res.dek;
    $('#secret1').value = $('#secret2').value = '';
    log(`cofre criado (${mode})`);
    show('Cofre criado e desbloqueado.');
    await showUnlocked();
  } catch (e) {
    show(`Não deu para criar: ${errText(e)}`);
    log(`erro ao criar: ${errText(e)}`);
  }
}

async function unlock(ev) {
  ev.preventDefault();
  const secret = $('#unlockSecret').value;
  $('#unlockSecret').value = '';
  const rec = await vaultStore.load();
  if (!rec?.wrapped) return refreshLocked();
  try {
    let prf = null;
    if (rec.mode === 'passkey') prf = await timed('faceIdMs', () => passkey.evaluate(rec.credentialId, vault.unb64(rec.prfSalt)));
    dek = await timed('unlockMs', () => vault.openVault(vaultStore, { prf, secret }));
    prf?.fill(0);
    log('desbloqueado');
    show('Desbloqueado.');
    await showUnlocked();
  } catch (e) {
    if (e instanceof vault.VaultWipedError) log('cofre destruído após 5 erros');
    else if (e instanceof vault.WrongSecretError) log('segredo errado');
    else log(`erro ao desbloquear: ${errText(e)}`);
    show(e instanceof vault.WrongSecretError ? 'PIN ou frase-senha errados.' : errText(e));
    await refreshLocked();
  }
}

async function start() {
  diag.userAgent = navigator.userAgent;
  diag.standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  diag.secureContext = isSecureContext;
  diag.rpId = location.hostname;
  await vault.loadKdf(globalThis.__POC_WASM__);
  diag.capabilities = await passkey.capabilities();
  try { diag.persist = await navigator.storage?.persist?.(); } catch (e) { diag.persist = String(e); }

  // Mede o Argon2id com os parâmetros reais, para calibrar no aparelho.
  const t0 = performance.now();
  (await import('./pkg/kdf_poc.js')).argon2id(new TextEncoder().encode('123456'), vault.random(16), vault.DEFAULT_ARGON.m, vault.DEFAULT_ARGON.t, vault.DEFAULT_ARGON.p);
  diag.argon2idMs = +(performance.now() - t0).toFixed(0);
  diag.argonParams = vault.DEFAULT_ARGON;

  $('#mode').addEventListener('change', () => {
    const pk = $('#mode').value === 'passkey';
    $('#secretLabel').textContent = pk ? 'PIN (6 a 12 números)' : 'Frase-senha (4 palavras ou 16 caracteres)';
    for (const id of ['#secret1', '#secret2']) $(id).inputMode = pk ? 'numeric' : 'text';
  });
  $('#setupForm').addEventListener('submit', create);
  $('#unlockForm').addEventListener('submit', unlock);
  $('#noteForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!dek) return;
    await store.putAll({ note: await vault.seal(dek, $('#note').value) });
    $('#note').value = '';
    await showUnlocked();
  });
  $('#lockBtn').addEventListener('click', () => lock('botão'));
  // Sair do app bloqueia na hora (§20): nada fica aberto no seletor de apps.
  document.addEventListener('visibilitychange', () => { if (document.hidden) lock('saiu do app'); });
  addEventListener('pagehide', () => lock('pagehide'));

  $('#copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(JSON.stringify({ ...diag, at: new Date().toISOString() }, null, 2)); show('Relatório copiado.'); }
    catch { show('Não deu para copiar: selecione o diagnóstico na mão.'); }
  });
  let armed = false;
  $('#reset').addEventListener('click', async (ev) => {
    if (!armed) {
      armed = true;
      ev.target.textContent = 'Toque de novo para apagar o cofre';
      setTimeout(() => { armed = false; ev.target.textContent = 'Apagar cofre e recomeçar'; }, 4000);
      return;
    }
    await store.clearAll();
    location.reload();
  });

  $('#app').hidden = false;
  show(diag.capabilities.platformAuthenticator === true ? 'Pronto.' : 'Este aparelho não informou Face ID/Touch ID disponível.');
  await refreshLocked();
  render();
}

start().catch((e) => { show(`Falhou: ${e.message || e}`); console.error(e); });
