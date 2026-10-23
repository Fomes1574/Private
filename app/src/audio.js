// Mensagem de áudio (V6-025, V6-018): até 1 hora, gravada do microfone e
// codificada na hora pelo próprio aparelho (nada vem de arquivo externo).
// Opus quando o navegador oferece; no Safari, AAC em MP4.
export const MAX_AUDIO_MS = 60 * 60 * 1000;
const TYPES = ['audio/webm;codecs=opus', 'audio/mp4;codecs=opus', 'audio/mp4', 'audio/aac'];

export function pickMime() {
  if (!globalThis.MediaRecorder) return null;
  return TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

export async function startRecording({ onTick, onLimit } = {}) {
  const mime = pickMime();
  if (mime === null) throw new Error('Este aparelho não grava áudio aqui.');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
  const parts = [];
  const t0 = Date.now();
  rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
  rec.start(1000);
  const tick = setInterval(() => {
    const ms = Date.now() - t0;
    onTick?.(ms);
    if (ms >= MAX_AUDIO_MS) { onLimit?.(); stop(); }
  }, 500);
  let resolveStop;
  const done = new Promise((r) => { resolveStop = r; });
  rec.onstop = async () => {
    clearInterval(tick);
    for (const tr of stream.getTracks()) tr.stop(); // microfone desligado na hora
    const blob = new Blob(parts, { type: rec.mimeType || mime || 'audio/mp4' });
    parts.length = 0;
    resolveStop({ bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type, ms: Date.now() - t0 });
  };
  function stop() { if (rec.state !== 'inactive') rec.stop(); return done; }
  function cancel() { rec.ondataavailable = null; parts.length = 0; if (rec.state !== 'inactive') rec.stop(); for (const tr of stream.getTracks()) tr.stop(); clearInterval(tick); }
  return { stop, cancel };
}

export const fmtDuration = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
