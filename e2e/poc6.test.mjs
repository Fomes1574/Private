import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, startServer, browser, watchErrors } from './helpers.mjs';

let stop, ctx;
before(async () => { stop = await startServer(); ctx = await browser(); });
after(async () => { await ctx?.close(); stop?.(); });

// Gera um vídeo de teste dentro do navegador e coloca no <input type=file>.
async function makeVideo(page, { width, height, seconds, fps, title }) {
  await page.evaluate(async ({ width, height, seconds, fps, title }) => {
    const mb = await import('./vendor/mediabunny.min.mjs');
    const target = new mb.BufferTarget();
    const out = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    const canvas = new OffscreenCanvas(width, height);
    const g = canvas.getContext('2d');
    const src = new mb.CanvasSource(canvas, { codec: 'vp9', bitrate: 8_000_000 });
    out.addVideoTrack(src, { frameRate: fps });
    const audio = new mb.AudioBufferSource({ codec: 'opus', bitrate: 64000 });
    out.addAudioTrack(audio);
    out.setMetadataTags({ title, comment: 'local: -23.55,-46.63' });
    await out.start();
    for (let i = 0; i < seconds * fps; i++) {
      g.fillStyle = `hsl(${(i * 7) % 360} 70% 50%)`; g.fillRect(0, 0, width, height);
      g.fillStyle = '#fff'; g.font = `${Math.floor(height / 8)}px sans-serif`; g.fillText(`quadro ${i}`, width / 10, height / 2);
      await src.add(i / fps, 1 / fps);
    }
    const ab = new AudioBuffer({ length: 48000 * seconds, numberOfChannels: 2, sampleRate: 48000 });
    await audio.add(ab);
    await out.finalize();
    const file = new File([target.buffer], 'teste.mp4', { type: 'video/mp4' });
    const dt = new DataTransfer(); dt.items.add(file);
    const input = document.querySelector('#file'); input.files = dt.files;
  }, { width, height, seconds, fps, title });
}

async function runCompress(page, preset = 'padrao') {
  await page.selectOption('#preset', preset);
  await page.click('#go');
  await page.waitForFunction(() => !/Comprimindo/.test(document.querySelector('#status').textContent), null, { timeout: 180000 });
  const d = JSON.parse(await page.textContent('#diag'));
  return d.runs.at(-1);
}

test('prova 6: 4K vira 1080p, sem metadados, e o limite de 5 min é respeitado', async () => {
  const page = await ctx.newPage();
  const errors = watchErrors(page);
  await page.goto(`${BASE}/poc6/?codec=vp9`);
  await page.waitForSelector('#app:not([hidden])');

  await makeVideo(page, { width: 3840, height: 2160, seconds: 3, fps: 30, title: 'segredo' });
  const r = await runCompress(page);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.out.width, r.out.height], [1920, 1080]);
  assert.ok(r.in.tagKeys.length > 0, 'o arquivo de teste tinha metadados');
  assert.deepEqual(r.out.tagKeys, [], 'metadados removidos');
  assert.ok(Math.abs(r.out.duration - 3) < 0.2, `duração preservada: ${r.out.duration}`);
  assert.equal(await page.isVisible('#result'), true);

  await makeVideo(page, { width: 64, height: 64, seconds: 301, fps: 1, title: 'longo' });
  const r2 = await runCompress(page);
  assert.equal(r2.ok, false);
  assert.match(r2.error, /5 minutos/);

  // Sem o parâmetro de teste a página exige H.264; este Chromium não tem.
  await page.goto(`${BASE}/poc6/`);
  await page.waitForSelector('#app:not([hidden])');
  await makeVideo(page, { width: 320, height: 240, seconds: 1, fps: 10, title: 'x' });
  const r3 = await runCompress(page);
  assert.equal(r3.ok, false);
  assert.match(r3.error, /H\.264/);
  console.log('prova 6:', JSON.stringify({ encodeMs: r.encodeMs, speedX: r.speedX, outBytes: r.outBytes }));
  assert.deepEqual(errors, []);
});
