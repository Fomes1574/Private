// O app de verdade, pela interface, contra a API local: duas pessoas.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { startApi, SETUP } from '../../server/test/helpers.mjs';
import { browser, virtualAuthenticator, watchErrors } from '../../e2e/helpers.mjs';

const APP_PORT = 8792;
const APP = `http://localhost:${APP_PORT}`;
const PIN = '284917';
let api, appProc, ana, bia;

before(async () => {
  api = await startApi(8793, { appOrigin: APP });
  execFileSync(process.execPath, ['build.mjs'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, MP_MODE: 'plain', MP_API: api.base, MP_TEST_HOOKS: '1' }, stdio: 'ignore' });
  appProc = spawn(new URL('../node_modules/.bin/wrangler', import.meta.url).pathname, ['dev', '--local', '--port', String(APP_PORT), '--ip', '127.0.0.1'],
    { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore', detached: true, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(APP + '/')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
});
after(async () => { await ana?.ctx.close(); await bia?.ctx.close(); api?.stop(); try { process.kill(-appProc.pid, 'SIGTERM'); } catch {} });

async function person() {
  const ctx = await browser();
  const page = await ctx.newPage();
  await virtualAuthenticator(page);
  return { ctx, page, errors: watchErrors(page) };
}
const status = (p) => p.page.textContent('#toast');

async function setupLock(p) {
  await p.page.fill('#s1', PIN); await p.page.fill('#s2', PIN);
  await p.page.click('form button');
}

async function enterNickname(p, nick) {
  await p.page.waitForSelector('#nick', { timeout: 60000 });
  await p.page.fill('#nick', nick);
  await p.page.click('form button');
  await p.page.waitForSelector('#search');
}

test('administradora instala, escolhe apelido e cria convite', async () => {
  ana = await person();
  await ana.page.goto(`${APP}/#instalar`);
  await ana.page.click('text=Instalar a primeira pessoa');
  await setupLock(ana);
  await ana.page.fill('#token', SETUP);
  await ana.page.click('text=Entrar');
  await enterNickname(ana, 'Ana');
});

let invite;
test('convite pela tela da administradora', async () => {
  await ana.page.click('[aria-label=Ajustes]');
  await ana.page.click('text=Criar convite');
  await ana.page.waitForFunction(() => [...document.querySelectorAll('.card .code.small')].some((e) => e.textContent.length > 40));
  invite = await ana.page.$$eval('.card .code.small', (els) => els.map((e) => e.textContent).find((t) => t.length > 40));
  assert.ok(invite);
  await ana.page.click('[aria-label=Voltar]');
});

test('Bia entra pelo convite, acha Ana pelo apelido e manda mensagem', async () => {
  bia = await person();
  await bia.page.goto(APP);
  await bia.page.click('text=Tenho um convite');
  await setupLock(bia);
  await bia.page.fill('#token', invite);
  await bia.page.click('text=Entrar');
  await enterNickname(bia, 'Bia');
  // O apelido da Ana chega cifrado pela conversa do círculo.
  await bia.page.waitForFunction(async () => true);
  for (let i = 0; i < 20; i++) {
    await bia.page.fill('#search', 'an');
    if (await bia.page.$('.results button')) break;
    await bia.page.waitForTimeout(1000);
  }
  await bia.page.click('.results button');
  await bia.page.waitForSelector('#composer');
  await bia.page.fill('#composer', 'oi, Ana! tudo cifrado?');
  await bia.page.click('[aria-label=Enviar]');
  await bia.page.waitForSelector('.msg.mine');
});

test('Ana recebe e responde; horário em Brasília; sem "visto"', async () => {
  for (let i = 0; i < 30; i++) {
    if (await ana.page.$('.row-btn .title')) break;
    await ana.page.waitForTimeout(1000);
  }
  await ana.page.click('.row-btn .title');
  await ana.page.waitForSelector('.msg:not(.mine)');
  assert.equal(await ana.page.textContent('.msg:not(.mine) .text'), 'oi, Ana! tudo cifrado?');
  const time = await ana.page.textContent('.msg:not(.mine) time');
  assert.match(time, /^\d{2}:\d{2}$/);
  const body = await ana.page.textContent('.chat'); // só a conversa (o aviso do convite diz "Entregue em mão")
  assert.doesNotMatch(body, /visto|entregue|online|digitando/i);
  await ana.page.fill('#composer', 'tudo, Bia 🌙');
  await ana.page.click('[aria-label=Enviar]');
  await bia.page.waitForFunction(() => [...document.querySelectorAll('.msg:not(.mine) .text')].some((e) => e.textContent === 'tudo, Bia 🌙'), null, { timeout: 40000 });
});

test('apagar para todos some do outro lado', async () => {
  await bia.page.fill('#composer', 'vou apagar isto');
  await bia.page.click('[aria-label=Enviar]');
  await ana.page.waitForFunction(() => [...document.querySelectorAll('.msg .text')].some((e) => e.textContent === 'vou apagar isto'), null, { timeout: 40000 });
  await bia.page.click('.msg.mine >> text=vou apagar isto');
  await bia.page.click('text=Apagar para todos');
  await bia.page.click('.sheet button.danger');
  await ana.page.waitForFunction(() => ![...document.querySelectorAll('.msg .text')].some((e) => e.textContent === 'vou apagar isto'), null, { timeout: 40000 });
});

test('foto de ver uma vez: segurar para ver, soltar esconde, uma vez só', async () => {
  const chooser = ana.page.waitForEvent('filechooser');
  await ana.page.click('[aria-label="Anexar foto ou vídeo"]');
  await ana.page.click('text=Foto de ver uma vez');
  await (await chooser).setFiles(new URL('../../poc/01-vodozemac-wasm/web/icon-512.png', import.meta.url).pathname);
  await ana.page.waitForSelector('text=Foto de ver uma vez (enviada)', { timeout: 30000 });
  assert.equal(await ana.page.$('.hold'), null, 'quem enviou não tem botão para reabrir');

  await bia.page.waitForSelector('.hold', { timeout: 40000 });
  const box = await (await bia.page.$('.hold')).boundingBox();
  await bia.page.mouse.move(box.x + 10, box.y + 10);
  await bia.page.mouse.down();
  await bia.page.waitForSelector('.viewer img', { timeout: 15000 });
  const overlayText = await bia.page.textContent('.viewer');
  assert.equal(overlayText.trim(), '', 'nada escrito sobre a foto (sem marca d\'água, nome, data)');
  await bia.page.mouse.up();
  await bia.page.waitForSelector('.viewer', { state: 'detached' });
  await bia.page.waitForSelector('text=Foto de ver uma vez (já vista)', { timeout: 15000 });
});

test('áudio: gravar, enviar cifrado e tocar do outro lado', async () => {
  await ana.page.click('[aria-label="Gravar áudio"]');
  await ana.page.waitForSelector('.rec-bar:not([hidden])');
  await ana.page.waitForTimeout(2200);
  await ana.page.click('text=Enviar áudio');
  await ana.page.waitForSelector('.msg.mine >> text=/Áudio · 0:0[2-3]/', { timeout: 20000 });
  await bia.page.waitForSelector('.msg:not(.mine) >> text=/Áudio · 0:0[2-3]/', { timeout: 40000 });
  await bia.page.click('.msg:not(.mine) >> text=/Áudio/');
  await bia.page.waitForSelector('.audio-box audio', { timeout: 15000 });
  const src = await bia.page.getAttribute('.audio-box audio', 'src');
  assert.match(src, /^blob:/, 'toca de blob local, sem URL do servidor');
  await bia.page.click('.audio-box >> text=Fechar');
  assert.equal(await bia.page.$('.sheet'), null, 'fechar o player não abre o menu da mensagem');
});

// Vídeo de teste gerado no navegador (VP9: o Chromium dos testes não tem
// H.264), com metadados que precisam sumir na recodificação.
const makeVideo = (p) => p.page.evaluate(async () => {
  const mb = await import('./video/vendor/mediabunny.min.mjs');
  const target = new mb.BufferTarget();
  const out = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const canvas = new OffscreenCanvas(640, 360);
  const g = canvas.getContext('2d');
  const src = new mb.CanvasSource(canvas, { codec: 'vp9', bitrate: 2_000_000 });
  out.addVideoTrack(src, { frameRate: 10 });
  out.setMetadataTags({ title: 'segredo', comment: 'local: -23.55,-46.63' });
  await out.start();
  for (let i = 0; i < 20; i++) { g.fillStyle = `hsl(${i * 17} 70% 50%)`; g.fillRect(0, 0, 640, 360); await src.add(i / 10, 0.1); }
  await out.finalize();
  let s = ''; for (const b of new Uint8Array(target.buffer)) s += String.fromCharCode(b);
  return btoa(s);
});

test('vídeo: recodificado no aparelho, enviado cifrado, abre do outro lado; ver uma vez só segurando', async () => {
  const video = Buffer.from(await makeVideo(ana), 'base64');
  for (const once of [false, true]) {
    const chooser = ana.page.waitForEvent('filechooser');
    await ana.page.click('[aria-label="Anexar foto ou vídeo"]');
    await ana.page.click(once ? 'text=Vídeo de ver uma vez' : 'text=Vídeo (até 5 min)');
    await (await chooser).setFiles({ name: 'praia.mp4', mimeType: 'video/mp4', buffer: video });
    await ana.page.waitForSelector(once ? 'text=Vídeo de ver uma vez (enviado)' : '.msg.mine >> text=/Vídeo · 0:02/', { timeout: 60000 })
      .catch(async (e) => { throw new Error(`${e.message.split('\n')[0]} | aviso: ${await status(ana)}`); });
  }
  await bia.page.waitForSelector('.msg:not(.mine) >> text=/Vídeo · 0:02/', { timeout: 40000 });
  await bia.page.click('.msg:not(.mine) >> text=/Vídeo · 0:02/');
  await bia.page.waitForSelector('.viewer video[controls]', { timeout: 15000 });
  const info = await bia.page.$eval('.viewer video', (v) => new Promise((ok) => {
    const done = () => ok({ src: v.src, w: v.videoWidth, d: v.duration, dl: v.getAttribute('controlslist'), pip: v.disablePictureInPicture });
    if (v.readyState >= 1) done(); else v.addEventListener('loadedmetadata', done, { once: true });
  }));
  assert.match(info.src, /^blob:/, 'toca de blob local');
  assert.equal(info.w, 640);
  assert.ok(Math.abs(info.d - 2) < 0.3, `duração ${info.d}`);
  assert.match(info.dl, /nodownload/);
  assert.equal(info.pip, true);
  await bia.page.click('.viewer-close');

  await bia.page.waitForSelector('.hold', { timeout: 40000 });
  const box = await (await bia.page.$('.hold')).boundingBox();
  await bia.page.mouse.move(box.x + 10, box.y + 10);
  await bia.page.mouse.down();
  await bia.page.waitForSelector('.viewer video:not([controls])', { timeout: 15000 });
  await bia.page.mouse.up();
  await bia.page.waitForSelector('.viewer', { state: 'detached' });
  await bia.page.waitForSelector('text=Vídeo de ver uma vez (já visto)', { timeout: 15000 });
});

const dbDirs = (p) => p.page.evaluate(async () => {
  const out = [];
  for await (const [name] of (await navigator.storage.getDirectory()).entries()) if (name.startsWith('.mp-')) out.push(name);
  return out.sort();
});

test('bloquear e desbloquear: conversa continua, guardada cifrada no aparelho', async () => {
  const before = await dbDirs(ana);
  assert.equal(before.length, 1, `um banco só: ${before}`);
  // Apaga uma mensagem só para si e tranca logo: a rotação roda antes de trancar.
  await ana.page.click('.msg.mine >> text=tudo, Bia 🌙');
  await ana.page.click('text=Apagar para mim');
  await ana.page.click('.sheet button.danger');
  await ana.page.waitForFunction(() => ![...document.querySelectorAll('.msg .text')].some((e) => e.textContent === 'tudo, Bia 🌙'));
  await ana.page.click('[aria-label=Voltar]');
  await ana.page.click('[aria-label=Ajustes]');
  await ana.page.click('text=Bloquear agora');
  await ana.page.waitForSelector('#secret');
  assert.equal(await ana.page.$('.msg'), null, 'nada aparece bloqueado');
  // Houve exclusão: ao trancar, o banco foi refeito com chave nova em outro
  // arquivo, e o antigo foi removido (ADR 0012).
  const after = await dbDirs(ana);
  assert.equal(after.length, 1, `um banco só depois da rotação: ${after}`);
  assert.notDeepEqual(after, before, 'arquivo do banco trocado');
  await ana.page.fill('#secret', '000001');
  await ana.page.click('text=Desbloquear');
  await ana.page.waitForFunction(() => /PIN errado/.test(document.querySelector('#toast').textContent));
  await ana.page.fill('#secret', PIN);
  await ana.page.click('text=Desbloquear');
  await ana.page.click('.row-btn .title');
  await ana.page.waitForFunction(() => [...document.querySelectorAll('.msg .text')].some((e) => e.textContent === 'oi, Ana! tudo cifrado?'));
  assert.ok(!(await ana.page.textContent('.chat')).includes('tudo, Bia 🌙'), 'apagada para mim não volta depois da rotação');
  // Bia, que não apagou, continua vendo (apagar para mim não afeta os outros).
  assert.ok((await bia.page.textContent('.chat')).includes('tudo, Bia 🌙'));
  const errs = [...ana.errors, ...bia.errors].filter((e) => !/status of (4\d\d)/.test(e));
  assert.deepEqual(errs, []);
});
