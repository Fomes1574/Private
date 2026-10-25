// Gravação só em memória; microfone liberado em todos os caminhos de saída.
import { sensitiveScope } from './sensitive-scope.js';
export const MAX_AUDIO_MS = 60 * 60 * 1000;
const TYPES = ['audio/webm;codecs=opus', 'audio/mp4;codecs=opus', 'audio/mp4', 'audio/aac'];
export function pickMime() {
  if (!globalThis.MediaRecorder) return null;
  return TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}
export async function startRecording({ onTick, onLimit, signal } = {}) {
  const scope = sensitiveScope({ signal });
  let stream, rec, tick, cancelled = false, resolveStop;
  const parts = [];
  const done = new Promise((resolve) => { resolveStop = resolve; });
  const release = () => { clearInterval(tick); for (const tr of stream?.getTracks() ?? []) tr.stop(); };
  function cancel() {
    cancelled = true; parts.length = 0;
    if (rec) { rec.ondataavailable = null; rec.onstop = null; rec.onerror = null; if (rec.state !== 'inactive') { try { rec.stop(); } catch {} } }
    release(); resolveStop(null); scope.finish();
  }
  scope.onCancel(cancel);
  try {
    const mime = pickMime();
    if (mime === null) throw new Error('Este aparelho não grava áudio aqui.');
    if (!scope.valid()) throw new DOMException('Gravação cancelada', 'AbortError');
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    if (!scope.valid()) throw new DOMException('Gravação cancelada', 'AbortError');
    rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
    const t0 = performance.now();
    rec.ondataavailable = (e) => { if (!cancelled && e.data.size) parts.push(e.data); };
    rec.onerror = () => scope.cancel();
    rec.onstop = async () => {
      release();
      try {
        if (!scope.valid() || cancelled) return cancel();
        const blob = new Blob(parts, { type: rec.mimeType || mime || 'audio/mp4' });
        parts.length = 0;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (!scope.valid() || cancelled) { bytes.fill(0); return cancel(); }
        scope.finish();
        resolveStop({ bytes, mime: blob.type, ms: performance.now() - t0 });
      } catch { cancel(); }
    };
    rec.start(1000);
    tick = setInterval(() => {
      if (!scope.valid()) return scope.cancel();
      const ms = performance.now() - t0;
      onTick?.(ms);
      if (ms >= MAX_AUDIO_MS) { onLimit?.(); stop(); }
    }, 500);
    function stop() {
      if (rec.state !== 'inactive') { rec.stop(); release(); }
      return done;
    }
    return { stop, cancel: () => scope.cancel() };
  } catch (e) { cancel(); throw e; }
}
export const fmtDuration = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
