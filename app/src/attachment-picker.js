// Só o token nativo (nenhum conteúdo) atravessa o bloqueio do seletor.
const plugin = () => globalThis.Capacitor?.isNativePlatform?.() ? globalThis.Capacitor.Plugins?.AttachmentPicker : null;
let pending = null;
export const nativePickerAvailable = () => !!plugin();
export async function selectNativeAttachment(roomId, pick) {
  const result = await plugin().pick({ kind: pick.doc ? 'doc' : pick.media ? 'media' : pick.video ? 'video' : 'photo' });
  pending = result.token ? { roomId, pick, token: result.token, at: Date.now() } : null;
}
export function pendingAttachment() {
  if (pending && Date.now() - pending.at > 5 * 60_000) { pending = null; plugin()?.clear().catch(() => {}); }
  return pending;
}
export function takeAttachment() { const value = pendingAttachment(); pending = null; return value; }
export function discardAttachment() { pending = null; return plugin()?.clear().catch(() => {}); }
export async function readNativeAttachment(selection, { signal, allowed }) {
  const p = plugin();
  let bytes;
  function check() { signal.throwIfAborted(); if (!allowed()) throw new DOMException('Sessão encerrada', 'AbortError'); }
  try {
    check(); const info = await p.describe({ token: selection.token }); check();
    const max = selection.pick.doc ? 20 * 1024 * 1024 : (selection.pick.video || selection.pick.media && /^video\//.test(info.mime)) ? 100 * 1024 * 1024 : 40 * 1024 * 1024;
    if (!Number.isSafeInteger(info.size) || info.size <= 0 || info.size > max) throw new Error('Arquivo grande demais ou inválido.');
    bytes = new Uint8Array(info.size);
    for (let offset = 0; offset < bytes.length;) {
      check(); const n = Math.min(192 * 1024, bytes.length - offset);
      const out = await p.read({ token: selection.token, offset, count: n }); check();
      const raw = atob(out.data);
      if (raw.length !== n) throw new Error('Arquivo incompleto.');
      for (let i = 0; i < raw.length; i++) bytes[offset + i] = raw.charCodeAt(i);
      offset += raw.length;
    }
    check(); return new File([bytes], info.name || 'arquivo', { type: info.mime || '' });
  } finally { bytes?.fill(0); await p.clear({ token: selection.token }).catch(() => {}); }
}
