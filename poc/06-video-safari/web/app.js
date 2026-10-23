import './tt.js'; // precisa vir antes de qualquer import da mediabunny
import { compress, VideoRejected } from './compress.js';

const $ = (s) => document.querySelector(s);
const diag = { runs: [] };
const params = new URLSearchParams(location.search);
// Só para o teste automático em navegador sem H.264.
const testCodec = params.get('codec');
let controller = null, lastUrl = null;

function show(t) { $('#status').textContent = t; }
function render() { $('#diag').textContent = JSON.stringify(diag, null, 2); }

async function capabilities() {
  const out = { webcodecs: 'VideoEncoder' in globalThis };
  if (!out.webcodecs) return out;
  for (const [n, c] of [['h264_1080p', 'avc1.640028'], ['h264_baseline', 'avc1.42001f'], ['hevc', 'hvc1.1.6.L120.B0'], ['vp9', 'vp09.00.40.08']]) {
    try { out[n] = (await VideoEncoder.isConfigSupported({ codec: c, width: 1920, height: 1080, bitrate: 2_500_000, framerate: 30 })).supported; } catch { out[n] = false; }
  }
  for (const [n, c] of [['aac', 'mp4a.40.2'], ['opus', 'opus']]) {
    try { out[n] = (await AudioEncoder.isConfigSupported({ codec: c, sampleRate: 48000, numberOfChannels: 2, bitrate: 96000 })).supported; } catch { out[n] = false; }
  }
  return out;
}

async function run() {
  const file = $('#file').files[0];
  if (!file) return show('Escolha um vídeo.');
  controller = new AbortController();
  $('#go').disabled = true;
  $('#cancel').hidden = false;
  $('#bar').hidden = false;
  $('#bar').value = 0;
  $('#result').hidden = true;
  if (lastUrl) { URL.revokeObjectURL(lastUrl); lastUrl = null; }
  show('Comprimindo…');
  let hiddenDuring = 0;
  const onVis = () => { if (document.hidden) hiddenDuring++; };
  document.addEventListener('visibilitychange', onVis);
  try {
    const { blob, stats } = await compress(file, {
      preset: $('#preset').value,
      videoCodec: testCodec || 'avc',
      onProgress: (p) => { $('#bar').value = p; },
      signal: controller.signal,
    });
    stats.leftAppDuring = hiddenDuring;
    diag.runs.push({ ok: true, preset: $('#preset').value, ...stats });
    lastUrl = URL.createObjectURL(blob);
    $('#preview').src = lastUrl;
    $('#result').hidden = false;
    show(`Pronto: ${(stats.inBytes / 1e6).toFixed(1)} MB → ${(stats.outBytes / 1e6).toFixed(1)} MB em ${(stats.encodeMs / 1000).toFixed(1)} s.`);
  } catch (e) {
    const msg = e instanceof VideoRejected ? e.message : `Falhou: ${e.message || e}. Nada foi enviado.`;
    diag.runs.push({ ok: false, error: String(e.message || e), leftAppDuring: hiddenDuring });
    show(controller.signal.aborted ? 'Cancelado.' : msg);
  } finally {
    document.removeEventListener('visibilitychange', onVis);
    $('#go').disabled = false;
    $('#cancel').hidden = true;
    $('#bar').hidden = true;
    render();
  }
}

async function start() {
  diag.userAgent = navigator.userAgent;
  diag.standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  diag.capabilities = await capabilities();
  $('#go').onclick = run;
  $('#cancel').onclick = () => controller?.abort();
  $('#copy').onclick = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify({ ...diag, at: new Date().toISOString() }, null, 2)); show('Relatório copiado.'); }
    catch { show('Não deu para copiar.'); }
  };
  $('#app').hidden = false;
  show(diag.capabilities.h264_1080p ? 'Pronto. Este aparelho codifica H.264.' : 'Atenção: este navegador não informou H.264; a compressão vai ser recusada.');
  render();
}

start().catch((e) => show(`Falhou: ${e.message || e}`));
