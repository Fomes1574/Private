// Recodifica um vídeo no aparelho (§14, V7-016): até 5 minutos, no máximo
// 1080p e 30 fps, H.264 em MP4, sem metadados (GPS, câmera, data). Nada sai
// do aparelho aqui: o resultado depois é cifrado e enviado.
import {
  Input, Output, Conversion, ALL_FORMATS, BlobSource, BufferTarget, Mp4OutputFormat,
  canEncodeVideo, canEncodeAudio,
} from './vendor/mediabunny.min.mjs';

export const MAX_SECONDS = 5 * 60; // V6-018
export const PRESETS = {
  padrao: { longSide: 1920, shortSide: 1080, fps: 30, videoBitrate: 2_500_000, audioBitrate: 96_000 },
  economico: { longSide: 1280, shortSide: 720, fps: 30, videoBitrate: 1_200_000, audioBitrate: 64_000 },
};

export class VideoRejected extends Error {}

// Cabe no retângulo sem aumentar e com lados pares (exigência do H.264).
export function fitSize(w, h, longSide, shortSide) {
  const landscape = w >= h;
  const maxW = landscape ? longSide : shortSide, maxH = landscape ? shortSide : longSide;
  const s = Math.min(1, maxW / w, maxH / h);
  const even = (x) => Math.max(2, Math.floor((x * s) / 2) * 2);
  return { width: even(w), height: even(h) };
}

export async function probe(file) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const video = await input.getPrimaryVideoTrack();
  const audio = await input.getPrimaryAudioTrack();
  const out = {
    duration: await input.computeDuration(),
    container: (await input.getFormat())?.name ?? null,
    video: video ? { codec: video.codec, width: video.displayWidth, height: video.displayHeight } : null,
    audio: audio ? { codec: audio.codec, channels: audio.numberOfChannels, sampleRate: audio.sampleRate } : null,
    tags: await input.getMetadataTags().catch(() => ({})),
  };
  input.dispose?.();
  return out;
}

// `videoCodec` existe para o teste automático (Chromium sem H.264). O app
// real usa sempre 'avc' e falha se o aparelho não codificar H.264.
export async function compress(file, { preset = 'padrao', videoCodec = 'avc', audioCodec = null, onProgress, signal } = {}) {
  const p = PRESETS[preset];
  const info = await probe(file);
  if (!info.video) throw new VideoRejected('O arquivo não tem vídeo.');
  if (!(info.duration > 0)) throw new VideoRejected('Não deu para ler a duração.');
  if (info.duration > MAX_SECONDS + 0.5) throw new VideoRejected(`Vídeo com ${Math.round(info.duration)} s; o limite é 5 minutos.`);

  const size = fitSize(info.video.width, info.video.height, p.longSide, p.shortSide);
  if (!(await canEncodeVideo(videoCodec, { ...size, bitrate: p.videoBitrate }))) {
    throw new VideoRejected(`Este aparelho não codifica ${videoCodec === 'avc' ? 'H.264' : videoCodec}. Nada foi enviado.`);
  }
  let aCodec = null;
  if (info.audio) {
    for (const c of audioCodec ? [audioCodec] : ['aac', 'opus']) {
      if (await canEncodeAudio(c, { numberOfChannels: Math.min(2, info.audio.channels), sampleRate: 48000, bitrate: p.audioBitrate })) { aCodec = c; break; }
    }
    if (!aCodec) throw new VideoRejected('Este aparelho não codifica o áudio. Nada foi enviado.');
  }

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const conversion = await Conversion.init({
    input, output,
    tracks: 'primary',
    copy: false, // sempre recodifica: nada do arquivo original passa direto (V7-016)
    tags: {}, // sem metadados: some GPS, modelo da câmera, data
    video: { ...size, fit: 'fill', codec: videoCodec, bitrate: p.videoBitrate, frameRate: p.fps, allowRotationMetadata: false },
    audio: info.audio ? { codec: aCodec, bitrate: p.audioBitrate, numberOfChannels: Math.min(2, info.audio.channels), sampleRate: 48000 } : { discard: true },
    showWarnings: false,
  });
  if (!conversion.isValid) {
    throw new VideoRejected(`Conversão impossível: ${conversion.discardedTracks.map((d) => d.reason).join(', ')}`);
  }
  if (onProgress) conversion.onProgress = onProgress;
  signal?.addEventListener('abort', () => conversion.cancel());
  const t0 = performance.now();
  await conversion.execute();
  const ms = performance.now() - t0;
  const blob = new Blob([target.buffer], { type: 'video/mp4' });
  const after = await probe(blob);
  return {
    blob,
    stats: {
      seconds: +info.duration.toFixed(2),
      inBytes: file.size,
      outBytes: blob.size,
      ratio: +(blob.size / file.size).toFixed(3),
      encodeMs: Math.round(ms),
      speedX: +(info.duration / (ms / 1000)).toFixed(2),
      in: { container: info.container, ...info.video, audio: info.audio?.codec ?? null, tagKeys: Object.keys(info.tags || {}) },
      out: { ...after.video, audio: after.audio?.codec ?? null, duration: +after.duration.toFixed(2), tagKeys: Object.keys(after.tags || {}) },
    },
  };
}
