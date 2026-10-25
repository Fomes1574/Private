// O app de verdade, pela interface, contra a API local: duas pessoas.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

// Ana desliga o modo máximo pela tela de Ajustes para testar o envio pela
// galeria; a Bia fica com o padrão (só câmera do app).
async function maxMode(p, on, other) {
  await p.page.click('[aria-label=Voltar]');
  await p.page.click('[aria-label=Ajustes]');
  const box = p.page.locator('#max-mode');
  assert.equal(await box.isChecked(), !on, 'estado anterior');
  if (on) await box.check(); else await box.uncheck();
  await p.page.waitForFunction((v) => /Modo máximo (ligado|desligado)/.test(document.querySelector('#toast').textContent), on);
  await p.page.click('[aria-label=Voltar]');
  await p.page.click(`.row-btn:has-text("${other}")`);
  await p.page.waitForSelector('#composer');
}

test('foto de ver uma vez: tocar abre, soltar mantém, fechar consome uma vez só', async () => {
  await maxMode(ana, false, 'Bia');
  const chooser = ana.page.waitForEvent('filechooser');
  await ana.page.click('[aria-label="Anexar foto ou vídeo"]');
  await ana.page.click('.sheet >> text=Galeria: foto de ver uma vez');
  await (await chooser).setFiles(new URL('../../poc/01-vodozemac-wasm/web/icon-512.png', import.meta.url).pathname);
  await ana.page.click('.editor >> text=Usar foto');
  await ana.page.waitForSelector('text=Foto de ver uma vez (enviada)', { timeout: 30000 });
  assert.equal(await ana.page.$('.once-open'), null, 'quem enviou não tem botão para reabrir');

  await bia.page.waitForSelector('.once-open', { timeout: 40000 });
  await bia.page.click('.once-open');
  await bia.page.waitForSelector('.viewer img', { timeout: 15000 });
  const overlayText = await bia.page.textContent('.viewer');
  assert.equal(overlayText.trim(), '×', 'só o botão de fechar, sem marca, nome ou data');
  await bia.page.waitForTimeout(250);
  assert.ok(await bia.page.$('.viewer img'), 'soltar o dedo não fecha nem perde a imagem');
  await bia.page.click('.viewer [aria-label=Fechar]');
  await bia.page.waitForSelector('.viewer', { state: 'detached' });
  await bia.page.waitForSelector('text=Foto de ver uma vez (abertura encerrada)', { timeout: 15000 });
});

test('áudio: gravar, enviar cifrado e tocar do outro lado', async () => {
  await ana.page.hover('[aria-label="Gravar áudio"]');
  await ana.page.mouse.down();
  await ana.page.waitForSelector('.rec-bar:not([hidden])');
  await ana.page.waitForTimeout(2200);
  await ana.page.mouse.up();
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

test('vídeo: recodificado no aparelho, enviado cifrado, abre do outro lado; ver uma vez por toque', async () => {
  const video = Buffer.from(await makeVideo(ana), 'base64');
  for (const once of [false, true]) {
    const chooser = ana.page.waitForEvent('filechooser');
    await ana.page.click('[aria-label="Anexar foto ou vídeo"]');
    await ana.page.click(once ? '.sheet >> text=Galeria: vídeo de ver uma vez' : '.sheet >> text=Galeria: vídeo (até 5 min)');
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

  await bia.page.waitForSelector('.once-open', { timeout: 40000 });
  const box = await (await bia.page.$('.once-open')).boundingBox();
  await bia.page.mouse.move(box.x + 10, box.y + 10);
  await bia.page.mouse.down();
  await bia.page.mouse.up();
  await bia.page.waitForSelector('.viewer video[controls]', { timeout: 15000 });
  await bia.page.click('.viewer [aria-label=Fechar]');
  await bia.page.waitForSelector('.viewer', { state: 'detached' });
  await bia.page.waitForSelector('text=Vídeo de ver uma vez (abertura encerrada)', { timeout: 15000 });
});

test('documento de texto: enviado cifrado, aberto como texto puro (HTML não vira página)', async () => {
  const text = 'lista:\n- pão\n<img src=x onerror="document.title=\'xss\'"><script>document.title=\'xss\'</script>\nção ✓';
  const chooser = ana.page.waitForEvent('filechooser');
  await ana.page.click('[aria-label="Anexar foto ou vídeo"]');
  await ana.page.click('text=Documento: texto ou PDF (até 20 MB)');
  await (await chooser).setFiles({ name: 'notas/../secreto.txt', mimeType: 'text/plain', buffer: Buffer.from(text) });
  await ana.page.waitForSelector('.msg.mine >> text=/Documento · notas..secreto.txt/', { timeout: 30000 })
    .catch(async (e) => { throw new Error(`${e.message.split('\n')[0]} | aviso: ${await status(ana)}`); });
  await bia.page.waitForSelector('.msg:not(.mine) >> text=/Documento · notas..secreto.txt · abrir/', { timeout: 40000 });
  await bia.page.click('.msg:not(.mine) >> text=/Documento ·/');
  await bia.page.waitForSelector('.viewer.doc .doc-text');
  assert.equal(await bia.page.textContent('.viewer.doc .doc-text'), text, 'conteúdo idêntico, como texto');
  assert.equal(await bia.page.$('.viewer img, .viewer script'), null, 'nenhum elemento criado a partir do documento');
  assert.notEqual(await bia.page.title(), 'xss');
  await bia.page.click('.viewer-close');

  // Binário é recusado antes de sair do aparelho.
  const c2 = ana.page.waitForEvent('filechooser');
  await ana.page.click('[aria-label="Anexar foto ou vídeo"]');
  await ana.page.click('text=Documento: texto ou PDF (até 20 MB)');
  await (await c2).setFiles({ name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from([0xff, 0xfe, 0, 1, 2]) });
  await ana.page.waitForFunction(() => /Não enviou: só texto \(UTF-8\) ou PDF/.test(document.querySelector('#toast').textContent));
});

// PDF mínimo com: um retângulo preto (tinta garantida), texto, JavaScript
// que rodaria ao abrir e um link para fora. Só o desenho pode acontecer.
function hostilePdf() {
  const content = 'q 0 0 0 rg 50 500 300 100 re f Q BT /F1 36 Tf 50 700 Td (Pacto PDF) Tj ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R /OpenAction 5 0 R /Names << /JavaScript << /Names [(x) 5 0 R] >> >> >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 6 0 R >> >> /Annots [7 0 R] >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /S /JavaScript /JS (document.title='pdfxss'; app.launchURL('https://exemplo.invalid/js', true);) >>",
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Annot /Subtype /Link /Rect [50 500 350 600] /A << /S /URI /URI (https://exemplo.invalid/link) >> >>',
  ];
  let out = '%PDF-1.7\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

test('PDF: aberto dentro do app, só desenhado; JavaScript, ação automática e link não fazem nada', async () => {
  const outside = [];
  bia.page.on('request', (r) => { if (r.url().includes('exemplo.invalid')) outside.push(r.url()); });
  const popups = [];
  bia.ctx.on('page', (p) => popups.push(p.url()));
  const chooser = ana.page.waitForEvent('filechooser');
  await ana.page.click('[aria-label="Anexar foto ou vídeo"]');
  await ana.page.click('text=Documento: texto ou PDF (até 20 MB)');
  await (await chooser).setFiles({ name: 'contrato.pdf', mimeType: 'application/pdf', buffer: hostilePdf() });
  await bia.page.waitForSelector('.msg:not(.mine) >> text=/Documento · contrato.pdf · abrir/', { timeout: 40000 });
  await bia.page.click('.msg:not(.mine) >> text=/Documento · contrato.pdf/');
  await bia.page.waitForSelector('.viewer.pdf canvas.pdf-page', { timeout: 30000 });
  await bia.page.waitForFunction(() => /1 página/.test(document.querySelector('.pdf-status')?.textContent ?? ''));
  await bia.page.waitForFunction(() => { const c=document.querySelector('canvas.pdf-page'); if (!c) return false; const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; for(let i=0;i<d.length;i+=4) if(d[i]+d[i+1]+d[i+2]<100 && d[i+3]>0) return true; return false; });
  const ink = await bia.page.evaluate(() => {
    const c = document.querySelector('canvas.pdf-page');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 100 && d[i + 3] > 0) dark++;
    return dark / (d.length / 4);
  });
  assert.ok(ink > 0.01, `página desenhada (tinta ${ink})`);
  // Toca bem em cima do link: nada abre.
  await bia.page.click('canvas.pdf-page', { position: { x: 100, y: 180 } });
  await bia.page.waitForTimeout(1500);
  assert.notEqual(await bia.page.title(), 'pdfxss', 'JavaScript do PDF não roda');
  assert.deepEqual(outside, [], 'nenhum acesso ao endereço do PDF');
  assert.deepEqual(popups, [], 'nenhuma janela ou app aberto');
  assert.equal(await bia.page.$('.viewer.pdf a, .viewer.pdf .annotationLayer, .viewer.pdf .textLayer'), null, 'sem camada de links ou texto');
  await bia.page.click('.viewer-close');
  assert.equal(await bia.page.$('.viewer.pdf'), null);

  // "PDF" que não é PDF (nome .pdf, conteúdo de .docx/zip) é recusado no envio.
  const c2 = ana.page.waitForEvent('filechooser');
  await ana.page.click('[aria-label="Anexar foto ou vídeo"]');
  await ana.page.click('text=Documento: texto ou PDF (até 20 MB)');
  await (await c2).setFiles({ name: 'falso.pdf', mimeType: 'application/pdf', buffer: Buffer.from([0x50, 0x4b, 3, 4, 0, 0, 0xff, 0xfe]) });
  await ana.page.waitForFunction(() => /Não enviou: só texto \(UTF-8\) ou PDF/.test(document.querySelector('#toast').textContent));
});

test('APK: seletor retorna só token e só lê a foto depois de desbloquear', async () => {
  const encoded = readFileSync(new URL('../../poc/01-vodozemac-wasm/web/icon-512.png', import.meta.url)).toString('base64');
  await ana.page.evaluate((encoded) => {
    window.pickerCalls=[];
    window.Capacitor={isNativePlatform:()=>true,Plugins:{BiometricSecret:{},AttachmentPicker:{
      pick:async()=>{pickerCalls.push('pick');return {token:'selected-file'};},
      authorize:async()=>{pickerCalls.push('authorize');},
      describe:async()=>{pickerCalls.push('describe');return {name:'foto.png',mime:'image/png',size:atob(encoded).length};},
      read:async()=>{pickerCalls.push('read');return {data:encoded};},
      clear:async()=>{pickerCalls.push('clear');}
    }}};
  }, encoded);
  await ana.page.click('[aria-label="Anexar foto ou vídeo"]');
  await ana.page.click('.sheet >> text=Galeria: foto', { exact: true });
  await ana.page.waitForSelector('#secret');
  assert.deepEqual(await ana.page.evaluate(()=>pickerCalls),['pick']);
  await ana.page.fill('#secret',PIN);await ana.page.click('form button');
  await ana.page.waitForSelector('text=Continuar com o anexo');
  assert.equal(await ana.page.evaluate(()=>pickerCalls.includes('read')),false);
  await ana.page.click('text=Continuar com o anexo');
  await ana.page.waitForSelector('.editor');
  const calls=await ana.page.evaluate(()=>pickerCalls);
  assert.ok(calls.indexOf('authorize')<calls.indexOf('describe'));assert.ok(calls.includes('read'));
  await ana.page.click('.editor >> text=Cancelar');
  await ana.page.evaluate(()=>{delete window.Capacitor;delete window.pickerCalls;});
});

test('rotação real do SQLite não perde escrita entre rebuild e troca', async () => {
  await ana.page.evaluate(() => {
    const {S,rotate}=globalThis.__mpTest;
    window.savedRebuild=S.store.rebuild.bind(S.store);
    window.rotationGate=new Promise(r=>window.finishRotation=r);
    S.store.rebuild=async(...args)=>{const r=await savedRebuild(...args);window.rebuilt=true;await rotationGate;return r;};
    window.rotationTask=rotate();
  });
  await ana.page.waitForFunction(()=>window.rebuilt===true);
  await ana.page.evaluate(()=>{window.raceWrite=globalThis.__mpTest.S.store.put('rotation-race',{text:'escrita concorrente'});window.finishRotation();});
  const saved=await ana.page.evaluate(async()=>{
    await Promise.all([rotationTask,raceWrite]);const {S}=globalThis.__mpTest;
    S.store.rebuild=savedRebuild;
    const r=await S.store.get('rotation-race');await S.store.put('rotation-race',undefined);
    delete window.rotationTask;delete window.raceWrite;delete window.rebuilt;return r;
  });
  assert.deepEqual(saved,{text:'escrita concorrente'});
});

test('sincronizar mantém posição e botão de ver uma vez; seta desce sem consumir', async()=>{
  await ana.page.evaluate(async()=>{
    const {S}=globalThis.__mpTest;const now=S.clock.now();
    const room=Object.keys(S.rooms).find(id=>S.client.trusted[id]?.members.length===2);
    window.scrollRoom=room;window.scrollIds=[];
    for(let i=0;i<45;i++){
      const msgId='scrolltest'+String(i).padStart(3,'0');scrollIds.push(msgId);
      await S.store.putMessage({msgId,room,sender:S.client.userId,kind:'text',text:'histórico de rolagem '+i,acceptedAt:now-60000+i,expiresAt:now+3600000});
    }
    const msgId='scrolltestonce';scrollIds.push(msgId);
    await S.store.putMessage({msgId,room,sender:'friend-test',kind:'media',body:{mode:'once',mime:'image/jpeg',mediaId:'scrollmedia',key:'unused'},acceptedAt:now+1,expiresAt:now+3600000});
  });
  await ana.page.click('[aria-label=Voltar]');await ana.page.click('.row-btn:has-text("Bia")');
  await ana.page.waitForSelector('.once-open');
  await ana.page.evaluate(()=>{window.stableOnce=document.querySelector('.once-open');document.querySelector('.messages').scrollTop=0;});
  await ana.page.evaluate(()=>globalThis.__mpTest.syncNow());
  assert.equal(await ana.page.evaluate(()=>document.querySelector('.messages').scrollTop),0);
  assert.equal(await ana.page.evaluate(()=>stableOnce===document.querySelector('.once-open')),true);
  await ana.page.click('.jump-bottom');assert.ok(await ana.page.evaluate(()=>document.querySelector('.messages').scrollTop)>0);
  await ana.page.evaluate(async()=>{await globalThis.__mpTest.S.store.deleteMessages(scrollIds);delete window.scrollIds;delete window.stableOnce;await globalThis.__mpTest.syncNow();});
});

test('rascunho: fica no aparelho ao sair da conversa e some ao enviar', async () => {
  await bia.page.fill('#composer', 'rascunho que não foi enviado');
  await bia.page.waitForTimeout(800);
  await bia.page.click('[aria-label=Voltar]');
  await bia.page.click('.row-btn .title');
  await bia.page.waitForSelector('#composer');
  assert.equal(await bia.page.inputValue('#composer'), 'rascunho que não foi enviado');
  await bia.page.click('[aria-label=Enviar]');
  await bia.page.waitForSelector('.msg.mine >> text=rascunho que não foi enviado');
  await bia.page.click('[aria-label=Voltar]');
  await bia.page.click('.row-btn .title');
  await bia.page.waitForSelector('#composer');
  assert.equal(await bia.page.inputValue('#composer'), '');
});

test('foto de perfil: cifrada, chega ao círculo e aparece na lista; trocar apaga a anterior', async () => {
  await ana.page.click('[aria-label=Voltar]');
  await ana.page.click('[aria-label=Ajustes]');
  const chooser = ana.page.waitForEvent('filechooser');
  await ana.page.click('text=Foto de perfil');
  await ana.page.click('.sheet >> text=Galeria');
  await (await chooser).setFiles(new URL('../../poc/01-vodozemac-wasm/web/icon-512.png', import.meta.url).pathname);
  await ana.page.waitForFunction(() => /Foto de perfil trocada/.test(document.querySelector('#toast').textContent), null, { timeout: 20000 });
  await ana.page.waitForSelector('.avatar.big img');
  const first = await ana.page.evaluate(() => globalThis.__mpTest.S.nicknames[globalThis.__mpTest.S.client.userId].photo.mediaId);

  await bia.page.click('[aria-label=Voltar]');
  await bia.page.waitForSelector('.row-btn .avatar img', { timeout: 40000 });
  assert.match(await bia.page.getAttribute('.row-btn .avatar img', 'src'), /^blob:/, 'decifrada no aparelho');

  // Trocar: a versão anterior deixa de existir no servidor.
  const c2 = ana.page.waitForEvent('filechooser');
  await ana.page.click('text=Foto de perfil');
  await ana.page.click('text=Trocar foto');
  await ana.page.click('.sheet >> text=Galeria');
  await (await c2).setFiles(new URL('../../poc/01-vodozemac-wasm/web/icon-180.png', import.meta.url).pathname);
  await ana.page.waitForFunction((old) => globalThis.__mpTest.S.nicknames[globalThis.__mpTest.S.client.userId].photo?.mediaId !== old, first, { timeout: 20000 });
  const status = await bia.page.evaluate(async ([base, id]) => (await fetch(`${base}/v1/visual/${id}`, { headers: { authorization: `Bearer ${globalThis.__mpTest.S.client.api.token}` } })).status, [api.base, first]);
  assert.equal(status, 404, 'foto antiga apagada');
  await ana.page.click('[aria-label=Voltar]');
  await ana.page.click('.row-btn .title');
  await ana.page.waitForSelector('#composer');
  await bia.page.click('.row-btn .title');
  await bia.page.waitForSelector('#composer');
});

test('grupo: foto e fundo só da líder, cifrados, chegam a quem está no grupo', async () => {
  await ana.page.click('[aria-label=Voltar]');
  await ana.page.click('[aria-label="Novo grupo"]');
  await ana.page.fill('#title', 'Família');
  await ana.page.check('label.check:has-text("Bia") input');
  await ana.page.click('text=Criar grupo');
  await ana.page.waitForSelector('#composer');
  for (const [item, file, msg] of [['Foto do grupo', 'icon-512.png', /Foto do grupo trocada/], ['Fundo da conversa', 'icon-180.png', /Fundo da conversa trocada/]]) {
    const chooser = ana.page.waitForEvent('filechooser');
    await ana.page.click('[aria-label="Menu da conversa"]');
    await ana.page.click(`.sheet >> text=${item}`);
    await ana.page.click('.sheet >> text=Galeria');
    await (await chooser).setFiles(new URL(`../../poc/01-vodozemac-wasm/web/${file}`, import.meta.url).pathname);
    await ana.page.waitForFunction((re) => new RegExp(re).test(document.querySelector('#toast').textContent), msg.source, { timeout: 20000 });
  }
  await bia.page.click('[aria-label=Voltar]');
  await bia.page.waitForSelector('.row-btn:has-text("Família") .avatar img', { timeout: 40000 });
  await bia.page.click('.row-btn:has-text("Família")');
  await bia.page.waitForSelector('.messages.has-bg', { timeout: 15000 });
  assert.match(await bia.page.$eval('.messages', (e) => e.style.backgroundImage), /^url\("blob:/, 'fundo decifrado no aparelho');
  // Quem não é líder não tem as opções.
  await bia.page.click('[aria-label="Menu da conversa"]');
  assert.equal(await bia.page.$('.sheet >> text=Foto do grupo'), null);
  await bia.page.click('.sheet >> text=Fechar');
  for (const [p, other] of [[ana, 'Bia'], [bia, 'Ana']]) {
    await p.page.click('[aria-label=Voltar]');
    await p.page.click(`.row-btn:has-text("${other}")`);
    await p.page.waitForSelector('#composer');
  }
});

test('menu da conversa: buscar, silenciar, fixar, arquivar e apagar conversa só para mim', async () => {
  const menu = async (p, item) => { await p.page.click('[aria-label="Menu da conversa"]'); await p.page.click(`.sheet >> text=${item}`); };
  // Busca local, sem acento e sem maiúscula.
  await menu(bia, 'Buscar nesta conversa');
  await bia.page.fill('#chat-search', 'CIFRADO');
  await bia.page.waitForFunction(() => document.querySelectorAll('.msg').length === 1);
  assert.match(await bia.page.textContent('.msg'), /tudo cifrado/);
  await bia.page.fill('#chat-search', 'zzz-nada');
  await bia.page.waitForSelector('text=Nada encontrado');
  await bia.page.click('[aria-label="Fechar busca"]');
  // Silenciar: o servidor guarda só "até quando".
  await menu(bia, 'Silenciar');
  await bia.page.click('.sheet >> text=8 horas');
  await bia.page.waitForFunction(() => /silenciada/.test(document.querySelector('#toast').textContent));
  await menu(bia, 'Fixar no topo');
  await bia.page.click('[aria-label=Voltar]');
  await bia.page.waitForSelector('.row-btn .title >> text=/📌 Ana 🔕/');
  assert.match(await bia.page.textContent('.list:not(.results) li:first-child'), /Ana/, 'fixada no topo');
  // Arquivar o grupo e apagá-lo só deste aparelho.
  await bia.page.click('.row-btn:has-text("Família")');
  await bia.page.fill('#composer', 'mensagem do grupo');
  await bia.page.click('[aria-label=Enviar]');
  await bia.page.waitForSelector('.msg.mine >> text=mensagem do grupo');
  await menu(bia, 'Apagar conversa (só para mim)');
  await bia.page.click('.sheet button.danger');
  await bia.page.waitForSelector('text=Nenhuma mensagem.');
  await menu(bia, 'Arquivar');
  await bia.page.click('[aria-label=Voltar]');
  await bia.page.waitForSelector('text=Arquivadas (1)');
  assert.equal(await bia.page.$('.list:not(.results) .row-btn:has-text("Família")'), null, 'arquivada sai da lista principal');
  await bia.page.click('text=Arquivadas (1)');
  await bia.page.waitForSelector('.row-btn:has-text("Família")');
  await bia.page.click('text=Voltar às conversas');
  // Para a Ana, a mensagem do grupo continua (apagar para mim não apaga dos outros).
  await ana.page.click('[aria-label=Voltar]');
  await ana.page.click('.row-btn:has-text("Família")');
  await ana.page.waitForSelector('.msg >> text=mensagem do grupo', { timeout: 40000 });
  for (const [p, other] of [[ana, 'Bia'], [bia, 'Ana']]) {
    if (p === ana) await p.page.click('[aria-label=Voltar]');
    await p.page.click(`.row-btn:has-text("${other}")`);
    await p.page.waitForSelector('#composer');
  }
});

test('legenda vai cifrada com a foto; recado aparece para o círculo', async () => {
  await ana.page.fill('#composer', 'pôr do sol 🌅');
  const chooser = ana.page.waitForEvent('filechooser');
  await ana.page.click('[aria-label="Anexar foto ou vídeo"]');
  await ana.page.click('.sheet button:text-is("Galeria: foto")');
  await (await chooser).setFiles(new URL('../../poc/01-vodozemac-wasm/web/icon-180.png', import.meta.url).pathname);
  await ana.page.click('.editor >> text=Usar foto');
  await ana.page.waitForSelector('.msg.mine .caption >> text=pôr do sol 🌅', { timeout: 30000 });
  assert.equal(await ana.page.inputValue('#composer'), '', 'texto virou legenda');
  await bia.page.waitForSelector('.msg:not(.mine) .caption >> text=pôr do sol 🌅', { timeout: 40000 });

  await ana.page.click('[aria-label=Voltar]');
  await ana.page.click('[aria-label=Ajustes]');
  await ana.page.click('button:text-is("Recado")');
  await ana.page.fill('#sheet-text', 'de férias até sexta');
  await ana.page.click('.sheet >> text=Salvar');
  await ana.page.waitForSelector('#about >> text=de férias até sexta');
  await bia.page.waitForFunction(() => Object.values(globalThis.__mpTest.S.nicknames).some((n) => n.about === 'de férias até sexta'), null, { timeout: 40000 });
  await bia.page.click('[aria-label="Menu da conversa"]');
  await bia.page.click('.sheet >> text=Participantes e verificação');
  await bia.page.waitForSelector('.sheet >> text=de férias até sexta');
  await bia.page.click('.sheet >> text=Fechar');
  await ana.page.click('[aria-label=Voltar]');
  await ana.page.click('.row-btn:has-text("Bia")');
  await ana.page.waitForSelector('#composer');
});

test('stories: audiência escolhida, sem contagem de quem viu, apagar some para todos', async () => {
  for (const p of [ana, bia]) { await p.page.click('[aria-label=Voltar]'); await p.page.click('[aria-label=Stories]'); }
  await ana.page.click('[aria-label="Publicar story"]');
  await ana.page.setInputFiles('#story-file', new URL('../../poc/01-vodozemac-wasm/web/icon-512.png', import.meta.url).pathname);
  assert.equal(await ana.page.inputValue('#story-ttl'), String(24 * 3600), 'padrão de 24 h');
  await ana.page.fill('#story-caption', 'café da manhã');
  await ana.page.click('.sheet >> text=Publicar');
  await ana.page.waitForSelector('.story-row >> text=Você', { timeout: 30000 });
  assert.equal(await ana.page.$('text=/visualiza|viram|visto por/i'), null, 'nada de quem viu');

  await bia.page.waitForSelector('.story-row >> text=Ana', { timeout: 40000 });
  assert.match(await bia.page.textContent('.story-row'), /café da manhã/);
  await bia.page.click('.story-row .row-btn');
  await bia.page.waitForSelector('.viewer img');
  assert.equal(await bia.page.$eval('.viewer', (v) => [...v.childNodes].filter((n) => !n.matches?.('.viewer-close')).map((n) => n.textContent).join('').trim()), '', 'nada escrito sobre a imagem');
  await bia.page.click('.viewer-close');

  await ana.page.click('.story-row >> text=Apagar');
  await ana.page.click('.sheet button.danger');
  await ana.page.waitForSelector('text=Nenhuma story no momento.');
  await bia.page.waitForSelector('text=Nenhuma story no momento.', { timeout: 40000 });
  for (const [p, other] of [[ana, 'Bia'], [bia, 'Ana']]) {
    await p.page.click('[aria-label=Voltar]');
    await p.page.click(`.row-btn:has-text("${other}")`);
    await p.page.waitForSelector('#composer');
  }
});

// BMP 300×200 (paisagem) gerado aqui, sem dependência.
function bmp(w, hgt) {
  const row = Math.ceil((w * 3) / 4) * 4, size = 54 + row * hgt, b = Buffer.alloc(size);
  b.write('BM'); b.writeUInt32LE(size, 2); b.writeUInt32LE(54, 10); b.writeUInt32LE(40, 14);
  b.writeInt32LE(w, 18); b.writeInt32LE(hgt, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28);
  for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) { const o = 54 + y * row + x * 3; b[o] = x % 256; b[o + 1] = 120; b[o + 2] = y % 256; }
  return b;
}

test('editor de foto: girar, desenhar e escrever no aparelho; cancelar não envia nada', async () => {
  const send = async (p) => {
    const chooser = p.page.waitForEvent('filechooser');
    await p.page.click('[aria-label="Anexar foto ou vídeo"]');
    await p.page.click('.sheet button:text-is("Galeria: foto")');
    await (await chooser).setFiles({ name: 'paisagem.png', mimeType: 'image/png', buffer: bmp(300, 200) });
    await p.page.waitForSelector('.editor canvas');
  };
  const before = await ana.page.$$eval('.msg.mine', (l) => l.length);
  const biaPhotos = () => bia.page.$$eval('.msg:not(.mine) .open', (l) => l.filter((b) => /Foto · tocar/.test(b.textContent)).length);
  const biaBefore = await biaPhotos();
  await send(ana);
  await ana.page.click('.editor >> text=Cancelar');
  await ana.page.waitForSelector('.editor', { state: 'detached' });
  await ana.page.waitForTimeout(500);
  assert.equal(await ana.page.$$eval('.msg.mine', (l) => l.length), before, 'cancelar não envia');

  await send(ana);
  await ana.page.click('.editor >> text=Girar');
  assert.deepEqual(await ana.page.$eval('.editor canvas', (c) => [c.width, c.height]), [200, 300]);
  const box = await (await ana.page.$('.editor canvas')).boundingBox();
  await ana.page.mouse.move(box.x + 10, box.y + 10); await ana.page.mouse.down();
  await ana.page.mouse.move(box.x + box.width - 10, box.y + box.height - 10, { steps: 5 }); await ana.page.mouse.up();
  await ana.page.click('.editor >> text=Escrever');
  await ana.page.fill('#editor-text', 'oi!');
  await ana.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await ana.page.click('.editor >> text=Usar foto');
  await ana.page.waitForFunction((n) => document.querySelectorAll('.msg.mine').length > n, before, { timeout: 30000 });

  await bia.page.waitForFunction((n) => [...document.querySelectorAll('.msg:not(.mine) .open')].filter((b) => /Foto · tocar/.test(b.textContent)).length > n, biaBefore, { timeout: 40000 });
  await bia.page.locator('.msg:not(.mine) >> text=Foto · tocar para ver').last().click();
  await bia.page.waitForSelector('.viewer img');
  const dims = await bia.page.$eval('.viewer img', (i) => new Promise((ok) => (i.complete ? ok([i.naturalWidth, i.naturalHeight]) : i.addEventListener('load', () => ok([i.naturalWidth, i.naturalHeight])))));
  assert.deepEqual(dims, [200, 300], 'chegou girada');
  await bia.page.click('.viewer-close');
});

test('câmera do app (modo máximo, padrão): foto e vídeo sem galeria nem arquivo', async () => {
  let picked = 0;
  bia.page.on('filechooser', () => { picked++; });
  const attachSheet = async () => { await bia.page.click('[aria-label="Anexar foto ou vídeo"]'); return bia.page.$$eval('.sheet button', (b) => b.map((x) => x.textContent)); };
  const opts = await attachSheet();
  assert.ok(opts.includes('Câmera: foto'));
  assert.ok(!opts.some((o) => /Galeria/.test(o)), 'modo máximo: sem galeria');
  const before = await ana.page.$$eval('.msg:not(.mine) .open', (l) => l.length);

  // Foto: abre a câmera do app, tira, edita, envia.
  await bia.page.click('.sheet >> text=Câmera: foto');
  await bia.page.waitForFunction(() => document.querySelector('.camera video')?.videoWidth > 0, null, { timeout: 15000 });
  await bia.page.click('[aria-label="Tirar foto"]');
  await bia.page.waitForSelector('.editor canvas');
  assert.equal(await bia.page.$('.camera'), null, 'câmera fechada');
  await bia.page.click('.editor >> text=Usar foto');
  await ana.page.waitForFunction((n) => document.querySelectorAll('.msg:not(.mine) .open').length > n, before, { timeout: 40000 });

  // Vídeo: grava ~2 s, recodifica e envia.
  await attachSheet();
  await bia.page.click('.sheet >> text=Câmera: vídeo (até 5 min)');
  await bia.page.waitForFunction(() => document.querySelector('.camera video')?.videoWidth > 0, null, { timeout: 15000 });
  await bia.page.click('[aria-label="Gravar"]');
  await bia.page.waitForTimeout(2300);
  await bia.page.click('[aria-label="Parar"]');
  await bia.page.waitForSelector('.msg.mine >> text=/Vídeo · 0:0[1-3]/', { timeout: 90000 })
    .catch(async (e) => { throw new Error(`${e.message.split('\n')[0]} | aviso: ${await status(bia)}`); });
  await ana.page.waitForSelector('.msg:not(.mine) >> text=/Vídeo · 0:0[1-3]/', { timeout: 40000 });

  // A câmera desliga na hora quando o app sai da tela.
  await attachSheet();
  await bia.page.click('.sheet >> text=Câmera: foto');
  await bia.page.waitForSelector('.camera');
  await bia.page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await bia.page.waitForSelector('.camera', { state: 'detached' });
  const live = await bia.page.evaluate(() => [...document.querySelectorAll('video')].some((v) => v.srcObject));
  assert.equal(live, false, 'nenhum vídeo da câmera ligado');
  await bia.page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(picked, 0, 'nenhum seletor de arquivo abriu');
  // Padrão "trancar na hora": sair do app tirou as chaves da memória.
  await bia.page.waitForSelector('#secret');
  assert.equal(await bia.page.evaluate(() => globalThis.__mpTest.S.unlocked), false);
  await bia.page.fill('#secret', PIN);
  await bia.page.click('text=Desbloquear');
  await bia.page.click('.row-btn:has-text("Ana")', { timeout: 15000 })
    .catch(async (e) => { throw new Error(`${e.message.split('\n')[0]} | tela: ${(await bia.page.textContent('#root')).slice(0, 200)} | aviso: ${await status(bia)} | erros: ${bia.errors.slice(-3).join(' / ')}`); });
  await bia.page.waitForSelector('#composer');
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
  await ana.page.click('.row-btn:has-text("Bia")');
  await ana.page.waitForFunction(() => [...document.querySelectorAll('.msg .text')].some((e) => e.textContent === 'oi, Ana! tudo cifrado?'));
  assert.ok(!(await ana.page.textContent('.chat')).includes('tudo, Bia 🌙'), 'apagada para mim não volta depois da rotação');
  // Bia, que não apagou, continua vendo (apagar para mim não afeta os outros).
  assert.ok((await bia.page.textContent('.chat')).includes('tudo, Bia 🌙'));
  const errs = [...ana.errors, ...bia.errors].filter((e) => !/status of (4\d\d)/.test(e));
  assert.deepEqual(errs, []);
});

// Lê os arquivos crus do banco no OPFS, como uma ferramenta de perícia faria,
// e procura os textos dentro da página (devolve só o tamanho e o que achou).
const rawDbScan = (p, needles = []) => p.page.evaluate(async (needles) => {
  let size = 0; const found = new Set();
  const dec = new TextDecoder('latin1');
  async function walk(dir) {
    for await (const [, h] of dir.entries()) {
      if (h.kind === 'directory') { await walk(h); continue; }
      const text = dec.decode(await (await h.getFile()).arrayBuffer());
      size += text.length;
      for (const n of needles) if (text.includes(n)) found.add(n);
    }
  }
  await walk(await navigator.storage.getDirectory());
  return { size, found: [...found] };
}, needles);

test('cópia do banco local (perícia): nem texto, nem id de conversa, nem id de mensagem em claro', async () => {
  const info = await bia.page.evaluate(async () => {
    const { S } = globalThis.__mpTest;
    const rooms = (await S.client.api.get('/v1/rooms')).rooms;
    const msgs = [];
    for (const r of rooms) msgs.push(...(await S.client.store.roomMessages(r)).map((m) => m.msgId));
    return { rooms, msgs, me: S.client.userId };
  });
  assert.ok(info.msgs.length > 0);
  const needles = [...info.rooms, ...info.msgs, info.me, 'oi, Ana', 'cifrado', 'nicknames', 'drafts', 'pickleKey'];
  const scan = await rawDbScan(bia, needles);
  assert.ok(scan.size > 10_000, 'leu os arquivos do banco');
  assert.deepEqual(scan.found, [], 'nada disso aparece em claro no arquivo');
});

test('PIN de coação: abre "novo", apaga tudo sem aviso; o PIN de verdade não abre mais', async () => {
  await bia.page.click('[aria-label=Voltar]');
  await bia.page.click('[aria-label=Ajustes]');
  await bia.page.click('text=Criar PIN de coação');
  await bia.page.fill('#pin-a', '739182'); await bia.page.fill('#pin-b', '739182');
  await bia.page.click('.sheet >> text=Salvar');
  await bia.page.waitForFunction(() => /PIN de coação criado/.test(document.querySelector('#toast').textContent), null, { timeout: 15000 });
  await bia.page.click('text=Bloquear agora');
  await bia.page.waitForSelector('#secret');
  await bia.page.fill('#secret', '739182');
  await bia.page.click('text=Desbloquear');
  await bia.page.waitForSelector('text=Tenho um convite', { timeout: 20000 });
  assert.doesNotMatch(await bia.page.evaluate(() => document.body.innerText), /destru|apagad|coação/i, 'nenhum aviso visível');
  assert.equal((await rawDbScan(bia)).size, 0, 'nada do banco ficou no aparelho');
  assert.equal(await bia.page.evaluate(() => Promise.race([new Promise((ok) => setTimeout(() => ok('travado'), 5000)),
    indexedDB.databases().then((l) => l.filter((d) => d.name === 'mp-app').length)])), 0, 'banco do cofre removido do IndexedDB');
});

test('código de emergência: de outro aparelho, mata o celular perdido', async () => {
  await ana.page.click('[aria-label=Voltar]');
  await ana.page.click('[aria-label=Ajustes]');
  await ana.page.click('text=Gerar código de emergência');
  const code = (await ana.page.textContent('#kill-code')).replace(/\s+/g, '');
  assert.equal(code.length, 24);
  await ana.page.click('text=Já anotei');
  // De outro aparelho (o da Bia, já vazio), sem conta nenhuma:
  await bia.page.click('text=Perdi meu celular');
  await bia.page.fill('#kill', code);
  await bia.page.click('text=Destruir o celular perdido');
  await bia.page.waitForFunction(() => /Pronto/.test(document.querySelector('#toast').textContent));
  // O celular da Ana: na próxima abertura, nada abre e o app volta a ser novo.
  await ana.page.click('text=Bloquear agora');
  await ana.page.waitForSelector('#secret');
  await ana.page.fill('#secret', PIN);
  await ana.page.click('text=Desbloquear');
  await ana.page.waitForSelector('text=/Tenho um convite|Instalar a primeira pessoa/', { timeout: 20000 });
  assert.equal((await rawDbScan(ana)).size, 0, 'banco da Ana apagado');
});
