// Câmera dentro do app (§17): a foto ou o vídeo nascem aqui, na memória,
// e só saem cifrados. Nada vai para a galeria, para o iCloud/Google Fotos
// nem para a pasta temporária do seletor de arquivos (que guarda o original
// com GPS e modelo do aparelho). Sair do app desliga a câmera na hora.
import { h, toast } from './ui.js';

export const MAX_VIDEO_MS = 5 * 60 * 1000; // V6-018
const VIDEO_TYPES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

const fmt = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// mode 'photo' → { bytes, mime: 'image/jpeg' } · mode 'video' → { blob, mime }
// Cancelar, sair do app ou negar a permissão → null.
export function openCamera({ mode = 'photo', facing = 'environment', maxSide = 2048 } = {}) {
  return new Promise((resolve) => {
    let stream = null, recorder = null, parts = [], t0 = 0, tick = null, done = false;
    const preview = h('video', { class: 'camera-preview', playsinline: true, autoplay: true, muted: true, 'aria-label': 'Imagem da câmera' });
    preview.muted = true;
    const timer = h('span', { class: 'camera-timer', hidden: true, text: '0:00' });
    const shutter = h('button', { class: 'camera-shutter', 'aria-label': mode === 'photo' ? 'Tirar foto' : 'Gravar', onclick: () => (mode === 'photo' ? snap() : toggleRec()) });
    const flip = h('button', { class: 'secondary small', text: 'Trocar câmera', onclick: () => { if (!recorder) { facing = facing === 'user' ? 'environment' : 'user'; start(); } } });
    const overlay = h('div', { class: 'camera', role: 'dialog', 'aria-modal': 'true', 'aria-label': mode === 'photo' ? 'Câmera' : 'Gravar vídeo' },
      h('div', { class: 'camera-bar row' }, h('button', { class: 'secondary small', text: 'Cancelar', onclick: () => finish(null) }), timer, flip),
      h('div', { class: 'camera-stage' }, preview),
      h('div', { class: 'camera-bar row center' }, shutter));

    function stopTracks() { for (const t of stream?.getTracks() ?? []) t.stop(); stream = null; preview.srcObject = null; }
    function finish(out) {
      if (done) return;
      done = true;
      clearInterval(tick);
      if (recorder && recorder.state !== 'inactive') { recorder.ondataavailable = null; recorder.onstop = null; recorder.stop(); }
      parts = [];
      stopTracks();
      overlay.remove();
      document.removeEventListener('visibilitychange', onHide);
      removeEventListener('pagehide', onHide);
      resolve(out);
    }
    // App escondido: câmera e microfone desligam e nada é guardado.
    const onHide = (e) => { if (document.hidden || e.type === 'pagehide') finish(null); };

    async function start() {
      stopTracks();
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: mode === 'video' ? { echoCancellation: true, noiseSuppression: true } : false,
        });
      } catch (e) {
        toast(e.name === 'NotAllowedError' ? 'Câmera negada. Libere nos ajustes do aparelho.' : `Câmera indisponível: ${e.message}`);
        return finish(null);
      }
      if (done) return stopTracks();
      preview.srcObject = stream;
      preview.classList.toggle('mirror', facing === 'user');
      await preview.play().catch(() => {});
    }

    async function snap() {
      if (!preview.videoWidth) return;
      const s = Math.min(1, maxSide / Math.max(preview.videoWidth, preview.videoHeight));
      const w = Math.round(preview.videoWidth * s), hh = Math.round(preview.videoHeight * s);
      const canvas = new OffscreenCanvas(w, hh);
      canvas.getContext('2d').drawImage(preview, 0, 0, w, hh);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
      finish({ bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/jpeg' });
    }

    function toggleRec() {
      if (recorder) return recorder.stop();
      const mime = VIDEO_TYPES.find((t) => globalThis.MediaRecorder?.isTypeSupported(t));
      if (!mime) { toast('Este aparelho não grava vídeo aqui.'); return finish(null); }
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 96_000 });
      parts = [];
      recorder.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(parts, { type: recorder.mimeType || mime });
        finish({ blob, mime: blob.type, ms: Date.now() - t0 });
      };
      recorder.start(1000);
      t0 = Date.now();
      shutter.classList.add('recording');
      shutter.setAttribute('aria-label', 'Parar');
      flip.disabled = true;
      timer.hidden = false;
      tick = setInterval(() => {
        const ms = Date.now() - t0;
        timer.textContent = fmt(ms);
        if (ms >= MAX_VIDEO_MS) { toast('Limite de 5 minutos.'); recorder.stop(); }
      }, 250);
    }

    document.addEventListener('visibilitychange', onHide);
    addEventListener('pagehide', onHide);
    document.body.append(overlay);
    start();
  });
}
