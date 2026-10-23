// Prova 5 · página. Ana cifra a foto com uma chave aleatória (CEK) e envia
// só os bytes cifrados. Bia e Caio seguram para ver; a abertura consome o
// direito no servidor antes de baixar.
const $ = (s) => document.querySelector(s);
const diag = { events: [] };
const tokens = {};
let media = null; // { id, cek, iv, expiresAt }

function show(t) { $('#status').textContent = t; }
function log(t) { diag.events.push(`${new Date().toISOString().slice(11, 19)} ${t}`); $('#diag').textContent = JSON.stringify(diag, null, 2); }

async function token(m) {
  if (!tokens[m]) {
    const r = await fetch('/v1/dev/token', { method: 'POST', body: JSON.stringify({ member: m }), headers: { 'x-prova': $('#code').value } });
    if (r.status === 401) throw new Error('código de acesso da prova errado');
    if (!r.ok) throw new Error('servidor sem tokens de teste');
    tokens[m] = (await r.json()).token;
  }
  return tokens[m];
}

const fmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

async function send() {
  const file = $('#file').files[0];
  if (!file) return show('Escolha uma foto.');
  // Na prova a foto vai como está. No app real ela é recodificada e perde
  // EXIF/GPS antes de cifrar (V7-016, §14).
  const plain = new Uint8Array(await file.arrayBuffer());
  const cek = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cek, plain));
  plain.fill(0);
  const t0 = performance.now();
  const r = await fetch(`/v1/media?ttl=${$('#ttl').value}&to=bia,caio`, { method: 'POST', body: ct, headers: { authorization: `Bearer ${await token('ana')}` } });
  const body = await r.json();
  if (!r.ok) return show(`Envio recusado: ${body.error}`);
  media = { id: body.mediaId, cek, iv, mime: file.type };
  diag.uploadMs = Math.round(performance.now() - t0);
  diag.bytes = ct.byteLength;
  log(`enviada; vence ${fmt.format(body.expiresAt)} (Brasília)`);
  show(`Enviada. Vence em ${fmt.format(body.expiresAt)}, horário de Brasília.`);
  for (const b of document.querySelectorAll('.hold')) b.disabled = false;
  for (const s of document.querySelectorAll('.state')) s.textContent = '';
  $('#revoke').hidden = false;
}

let url = null;
function hide(reason) {
  if ($('#viewer').hidden) return;
  $('#viewer').hidden = true;
  $('#viewImg').removeAttribute('src');
  if (url) { URL.revokeObjectURL(url); url = null; }
  log(`ocultada (${reason})`);
}

async function holdStart(who, el) {
  if (!media) return;
  const state = el.querySelector('.state');
  const r = await fetch(`/v1/media/${media.id}/open`, { method: 'POST', headers: { authorization: `Bearer ${await token(who)}` } });
  if (!r.ok) {
    const { error } = await r.json();
    const msg = { used: 'Já vista. Não abre de novo.', forbidden: 'Quem enviou não reabre.', gone: 'Não existe mais.', expired: 'Venceu.', revoked: 'Apagada para todos.' }[error] || error;
    state.textContent = msg;
    log(`${who}: ${error}`);
    return;
  }
  const ct = new Uint8Array(await r.arrayBuffer());
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: media.iv }, media.cek, ct);
  url = URL.createObjectURL(new Blob([plain], { type: media.mime }));
  $('#viewImg').src = url;
  $('#viewer').hidden = false;
  state.textContent = 'Aberta (direito consumido).';
  log(`${who}: aberta`);
}

async function start() {
  diag.userAgent = navigator.userAgent;
  diag.standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  $('#send').onclick = () => send().catch((e) => show(`Erro: ${e.message}`));
  $('#revoke').onclick = async () => {
    const r = await fetch(`/v1/media/${media.id}/revoke`, { method: 'POST', headers: { authorization: `Bearer ${await token('ana')}` } });
    log(`apagar para todos: ${r.status}`);
    show(r.ok ? 'Apagada para todos.' : 'Não foi possível apagar.');
  };
  for (const el of document.querySelectorAll('[data-who]')) {
    const btn = el.querySelector('.hold');
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); holdStart(el.dataset.who, el).catch((err) => show(err.message)); });
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  // Soltar o dedo, perder foco ou sair do app esconde na hora (§15, §20).
  for (const ev of ['pointerup', 'pointercancel']) addEventListener(ev, () => hide(ev));
  addEventListener('blur', () => hide('blur'));
  addEventListener('pagehide', () => hide('pagehide'));
  document.addEventListener('visibilitychange', () => { if (document.hidden) hide('visibilitychange'); });
  $('#copy').onclick = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify({ ...diag, at: new Date().toISOString() }, null, 2)); show('Relatório copiado.'); }
    catch { show('Não deu para copiar.'); }
  };
  $('#app').hidden = false;
  show('Pronto.');
}

start();
