// Prepara um vídeo para envio (§14, V7-016): recodifica no aparelho (até
// 5 min, 1080p, sem metadados); se passar do limite, tenta a qualidade
// econômica; se ainda não couber, recusa. Usado no chat e nas stories.
import { CONFIG } from './config.js';

// Abaixo do limite do servidor (100 MiB) com folga para a cifra segmentada.
export const MAX_VIDEO_BYTES = 95 * 1024 * 1024;

export async function prepareVideo(file, { onProgress, onStage, signal } = {}) {
  const { compress, VideoRejected } = await import('./video/compress.js');
  // Chromium dos testes não tem H.264; o app de verdade usa sempre H.264.
  const videoCodec = CONFIG.testHooks ? 'vp9' : 'avc';
  let r = null;
  try {
    for (const preset of ['padrao', 'economico']) {
      onStage?.(preset);
      r = await compress(file, { preset, videoCodec, onProgress, signal });
      if (r.blob.size <= MAX_VIDEO_BYTES) break;
      r = null;
    }
  } catch (e) {
    if (signal?.aborted) throw new Error('cancelado');
    throw e instanceof VideoRejected ? e : new Error(`não deu para preparar o vídeo (${e.message})`);
  }
  if (!r) throw new Error('vídeo grande demais mesmo comprimido. Nada foi enviado.');
  if (signal?.aborted) throw new Error('cancelado');
  return { bytes: new Uint8Array(await r.blob.arrayBuffer()), duration: Math.round(r.stats.out.duration * 1000) };
}
