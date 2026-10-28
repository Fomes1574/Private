// Só o token nativo (nenhum conteúdo) atravessa o bloqueio do seletor.
import { beginPickerTrip, endPickerTrip } from './picker-trip.js';
const plugin = () => globalThis.Capacitor?.isNativePlatform?.() ? globalThis.Capacitor.Plugins?.AttachmentPicker : null;
let pending = null;
export const nativePickerAvailable = () => !!plugin();
export async function selectNativeAttachment(roomId, pick) {
  // D4: no lote, a galeria deixa escolher várias (o app aceita até 5).
  const result = await plugin().pick({ kind: pick.doc ? 'doc' : pick.media ? 'media' : pick.video ? 'video' : 'photo', multiple: !!pick.batch });
  pending = result.token ? { roomId, pick, token: result.token, count: result.count ?? 1, dropped: result.dropped ?? 0, at: Date.now() } : null;
}
export function pendingAttachment() {
  if (pending && Date.now() - pending.at > 5 * 60_000) { pending = null; plugin()?.clear().catch(() => {}); }
  return pending;
}
// Espera o app voltar para a frente (o seletor nativo só libera a leitura
// com a janela do app em foco). Desiste em 3 s; a leitura recusa se faltar.
function foreground() {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => (!document.hidden && document.hasFocus()) || Date.now() - t0 > 3000 ? setTimeout(resolve, 0) : setTimeout(tick, 50);
    tick();
  });
}
// D13: abre o seletor sem trancar antes. Voltando em até 2 minutos com o app
// ainda aberto, devolve a seleção pronta para ler. Se trancou no caminho,
// devolve null e a seleção espera o PIN (o desbloqueio leva de volta a ela).
export async function pickInApp(roomId, pick, stillOpen) {
  beginPickerTrip();
  try { await selectNativeAttachment(roomId, pick); }
  catch (e) { endPickerTrip(); throw e; }
  await foreground();
  endPickerTrip();
  if (!pending || !stillOpen()) return null;
  await plugin().authorize();
  return takeAttachment();
}
export function takeAttachment() { const value = pendingAttachment(); pending = null; return value; }
export function discardAttachment() { pending = null; return plugin()?.clear().catch(() => {}); }
// Lê o item `index` da seleção. `keep`: não apaga a seleção no fim (lote).
export async function readNativeAttachment(selection, { signal, allowed, index = 0, keep = false }) {
  const p = plugin();
  let bytes;
  function check() { signal.throwIfAborted(); if (!allowed()) throw new DOMException('Sessão encerrada', 'AbortError'); }
  try {
    check(); const info = await p.describe({ token: selection.token, index }); check();
    const max = selection.pick.doc ? 20 * 1024 * 1024 : (selection.pick.video || selection.pick.media && /^video\//.test(info.mime)) ? 100 * 1024 * 1024 : 40 * 1024 * 1024;
    if (!Number.isSafeInteger(info.size) || info.size <= 0 || info.size > max) throw new Error('Arquivo grande demais ou inválido.');
    bytes = new Uint8Array(info.size);
    for (let offset = 0; offset < bytes.length;) {
      check(); const n = Math.min(192 * 1024, bytes.length - offset);
      const out = await p.read({ token: selection.token, index, offset, count: n }); check();
      const raw = atob(out.data);
      if (raw.length !== n) throw new Error('Arquivo incompleto.');
      for (let i = 0; i < raw.length; i++) bytes[offset + i] = raw.charCodeAt(i);
      offset += raw.length;
    }
    check(); return new File([bytes], info.name || 'arquivo', { type: info.mime || '' });
  } finally { bytes?.fill(0); if (!keep) await p.clear({ token: selection.token }).catch(() => {}); }
}
export async function clearNativeAttachment(selection) {
  await plugin()?.clear({ token: selection.token }).catch(() => {});
}
