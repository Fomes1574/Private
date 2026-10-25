// Verificar alguém (S8), como no WhatsApp: número de segurança da dupla e QR.
// Pessoalmente, um mostra o QR e o outro lê (Android); ou comparam os números.
// Bateu: "verificado". Se a chave mudar depois, o app avisa na conversa e
// pausa o envio de mídia até conferirem de novo (S1).
import { h, toast } from '../ui.js';
import * as session from '../session.js';
import { sensitiveScope } from '../sensitive-scope.js';

let qrLib;
async function drawQr(text, canvas) {
  qrLib ??= (await import('../vendor/qrcode/qrcode.mjs')).default;
  const qr = qrLib(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), cell = 6, pad = 4 * cell;
  canvas.width = canvas.height = n * cell + pad * 2;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect(pad + c * cell, pad + r * cell, cell, cell);
}

// Leitura do QR pela câmera do app. Só onde o sistema oferece leitor de QR
// (Android); no iPhone, comparar os números.
const canScan = () => 'BarcodeDetector' in globalThis;
function scanQr(expected) {
  return new Promise((resolve) => {
    const scope = sensitiveScope();
    const video = h('video', { class: 'camera-preview', playsinline: true, autoplay: true, muted: true, 'aria-label': 'Câmera lendo o QR' });
    const overlay = h('div', { class: 'camera', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Ler QR' },
      h('div', { class: 'camera-bar row' }, h('button', { class: 'secondary small', text: 'Cancelar', onclick: () => scope.cancel() })),
      h('div', { class: 'camera-stage' }, video));
    let stream = null, timer = null, done = false;
    const finish = (r) => { if (done) return; done = true; clearInterval(timer); for (const t of stream?.getTracks() ?? []) t.stop(); overlay.remove(); scope.finish(); resolve(r); };
    scope.onCancel(() => finish(null));
    document.body.append(overlay);
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (done || !scope.valid()) {
          for (const track of stream.getTracks()) track.stop();
          stream = null;
          return finish(null);
        }
        video.srcObject = stream;
        await video.play().catch(() => {});
        const det = new globalThis.BarcodeDetector({ formats: ['qr_code'] });
        timer = setInterval(async () => {
          try {
            const codes = await det.detect(video);
            const hit = codes.find((c) => c.rawValue?.startsWith('mp-verify:'));
            if (hit) finish(hit.rawValue === expected);
          } catch {}
        }, 300);
      } catch { toast('Câmera indisponível. Comparem os números.'); finish(null); }
    })();
  });
}

export async function verifySheet(userId) {
  const owner = session.S.client;
  const scope = sensitiveScope({ allowed: () => session.S.client === owner });
  const expected = session.verifyPayload(userId);
  const name = session.nameOf(userId);
  const number = await session.safetyNumber(userId);
  if (!scope.valid()) { scope.cancel(); return; }
  if (!number || expected !== session.verifyPayload(userId)) { scope.cancel(); return toast('A chave mudou. Abra a verificação novamente.'); }
  const payload = expected;
  const canvas = h('canvas', { class: 'qr', 'aria-label': `QR de verificação com ${name}` });
  const status = h('p', { class: 'muted small' });
  const actions = h('div', { class: 'row wrap' });
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Verificar ${name}` }, h('div', { class: 'sheet-box' },
    h('h2', { text: `Verificar ${name}` }),
    h('p', { class: 'muted small', text: `Encontrem-se pessoalmente. ${canScan() ? 'Um lê o QR do outro, ou comparem' : 'Comparem'} os 60 números: se forem iguais nos dois celulares, ninguém está no meio da conversa.` }),
    canvas,
    h('p', { class: 'code safety', text: number }),
    status, actions,
    h('button', { class: 'block', text: 'Fechar', onclick: () => scope.cancel() })));
  scope.onCancel(() => { canvas.width = canvas.height = 0; sheet.replaceChildren(); sheet.remove(); });
  async function confirm(on) {
    if (!scope.valid()) return;
    try {
      await session.setVerified(userId, on, payload);
      if (scope.valid()) { toast(on ? `${name} verificado.` : 'Verificação removida.'); refresh(); }
    } catch { scope.cancel(); toast('A chave mudou durante a conferência. Abra novamente e confira os novos números.'); }
  }
  const refresh = () => {
    const ok = session.isVerified(userId), changed = session.keyChanged(userId);
    status.textContent = ok ? '✓ Verificado.' : changed ? `A chave de ${name} mudou desde a verificação. Confiram de novo.` : 'Ainda não verificado.';
    actions.replaceChildren(
      canScan() ? h('button', { class: 'secondary', text: 'Ler o QR da outra pessoa', onclick: async () => {
        const r = await scanQr(payload);
        if (r === true) await confirm(true);
        else if (r === false) toast('O QR não bate. Não marque como verificado e avise a pessoa.');
      } }) : null,
      ok ? h('button', { class: 'secondary', text: 'Remover verificação', onclick: () => confirm(false) })
        : h('button', { text: 'Os números batem: marcar como verificado', onclick: () => confirm(true) }),
      changed ? h('button', { class: 'danger', text: 'Aceitar a chave nova sem conferir', onclick: () => confirm(false) }) : null);
  };
  refresh();
  document.body.append(sheet);
  drawQr(payload, canvas).catch(() => canvas.remove());
}
