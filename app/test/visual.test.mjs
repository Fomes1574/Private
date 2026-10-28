// E4: conferência visual em tamanho de celular. Em cada tela:
// - todo botão, campo e link visível precisa receber o toque no próprio
//   centro (nada por cima dele) e ter um nome (texto ou aria-label);
// - alvo de toque com menos de 24 px reprova;
// - com MP_SHOTS=<pasta>, salva uma foto da tela para revisão humana.
// Dados sintéticos. Não substitui olhar no celular de verdade.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { startApi, SETUP } from '../../server/test/helpers.mjs';
import { browser, virtualAuthenticator } from '../../e2e/helpers.mjs';
import { loadCrypto } from '../../packages/crypto/index.js';
import { TrustedClock } from '../../packages/protocol/src/time.js';
import { CIRCLE_ROOM_ID } from '../../packages/protocol/src/room.js';
import { MessengerClient, Api, MemoryStore } from '../../packages/client/src/index.js';

await loadCrypto(await readFile(new URL('../../packages/crypto/pkg/mp_crypto_bg.wasm', import.meta.url)));

const PORT = 8824;
const APP = `http://localhost:${PORT}`;
const PIN = '284917';
const SHOTS = process.env.MP_SHOTS;
const dist = new URL('../dist', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json' };
const PHOTO = new URL('../../poc/01-vodozemac-wasm/web/icon-512.png', import.meta.url).pathname;
let api, server, ctx, page, bia, direct, group;
const problems = [];

before(async () => {
  if (SHOTS) await mkdir(SHOTS, { recursive: true });
  api = await startApi(8825, { appOrigin: APP });
  execFileSync(process.execPath, ['build.mjs'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, MP_MODE: 'plain', MP_API: api.base, MP_TEST_HOOKS: '1' }, stdio: 'ignore' });
  server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, APP).pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = path.endsWith('/') ? `${path}index.html` : path;
    try {
      const body = await readFile(join(dist, file));
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  }).listen(PORT, '127.0.0.1');
});
after(async () => { await ctx?.close(); server?.close(); api?.stop(); });

// Confere a tela atual e guarda a foto. Devolve a lista de problemas dela.
async function audit(name) {
  await page.waitForTimeout(350); // animações curtas terminam
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) });
  const found = await page.evaluate(() => {
    const out = [];
    const vw = innerWidth, vh = innerHeight;
    const nameOf = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.getAttribute('placeholder') || (el.labels?.[0]?.textContent) || '').trim();
    // Com folha, editor ou câmera aberta, só a camada de cima recebe toques.
    const layer = [...document.querySelectorAll('[aria-modal="true"]')].at(-1) ?? document;
    const bar = document.querySelector('header.bar');
    for (const el of layer.querySelectorAll('button, input:not([type=hidden]), textarea, select, a[href], [role=button]')) {
      if (el.closest('[hidden], #cover') || el.hidden || el.type === 'file') continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (cx < 0 || cy < 0 || cx > vw || cy > vh) continue; // fora da tela: rolar resolve
      const label = nameOf(el).slice(0, 40);
      if (!label) out.push(`sem nome: <${el.tagName.toLowerCase()} class="${el.className}">`);
      const hit = document.elementFromPoint(cx, cy);
      if (layer === document && bar && !bar.contains(el) && bar.contains(hit)) continue; // rolou para baixo do cabeçalho
      if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) out.push(`coberto: "${label}" por <${hit.tagName.toLowerCase()} class="${hit.className?.baseVal ?? hit.className}">`);
      if (Math.min(r.width, r.height) < 24 && !el.matches('input[type=checkbox], input[type=radio]')) out.push(`pequeno demais (${Math.round(r.width)}x${Math.round(r.height)}): "${label}"`);
      if (r.right > vw + 1) out.push(`passa da tela: "${label}"`);
    }
    if (document.documentElement.scrollWidth > vw + 1) out.push(`rolagem lateral: ${document.documentElement.scrollWidth}px`);
    return out;
  });
  for (const f of found) problems.push(`${name}: ${f}`);
  return found;
}

test('E4: telas em tamanho de celular, botões alcançáveis e com nome', async () => {
  ctx = await browser();
  page = await ctx.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await virtualAuthenticator(page);
  await page.goto(`${APP}/#instalar`);
  await audit('01-boas-vindas');
  await page.click('text=Instalar a primeira pessoa');
  await audit('02-criar-pin');
  await page.fill('#s1', PIN); await page.fill('#s2', PIN); await page.click('form button');
  await page.fill('#token', SETUP); await page.click('text=Entrar');
  await page.waitForSelector('#nick');
  await audit('03-apelido');
  await page.fill('#nick', 'Ana'); await page.click('form button'); await page.waitForSelector('#search');
  await audit('04-lista-vazia');

  const token = await page.evaluate(async () => (await globalThis.__mpTest.S.client.api.post('/v1/invites', {})).token);
  bia = new MessengerClient({ api: new Api(api.base, new TrustedClock()), store: new MemoryStore(), pickleKey: crypto.getRandomValues(new Uint8Array(32)) });
  await bia.redeem(token); await bia.login(); await bia.refreshDirectory();
  ({ direct, group } = await page.evaluate(async (biaId) => {
    const { S, startDirect, confirmCircle } = globalThis.__mpTest;
    await S.client.refreshDirectory();
    await confirmCircle([S.client.userId, biaId]);
    const d = await startDirect(biaId);
    const g = await S.client.createRoom('group', [biaId]);
    return { direct: d.roomId, group: g.roomId };
  }, bia.userId));
  await bia.sync();
  await bia.sendInner(CIRCLE_ROOM_ID, 'nickname_change', { nickname: 'Bia', photo: null, about: null });
  for (const t of ['Oi! Chegou bem?', 'Cheguei sim, obrigada', 'Amanhã às 8 no lugar de sempre']) await bia.sendText(direct, t);
  await bia.sendText(group, 'Quem leva o lanche?');
  await page.evaluate(() => globalThis.__mpTest.syncNow());
  await page.waitForFunction(() => document.querySelectorAll('.row-btn').length >= 2, null, { timeout: 30000 });
  await audit('05-lista');

  await page.click('.row-btn:has(.title:has-text("Bia"))');
  await page.waitForSelector('#composer');
  await page.fill('#composer', 'Combinado, até amanhã');
  await page.click('[aria-label=Enviar]');
  await page.waitForSelector('.msg.mine:not(.pending)');
  await audit('06-conversa');
  await page.click('[aria-label="Anexar foto ou vídeo"]');
  await audit('07-anexar');
  await page.click('.sheet button:has-text("Fechar")');
  await page.click('[aria-label="Menu da conversa"]');
  await audit('08-menu-conversa');
  await page.click('.sheet button:has-text("Fechar")');
  await page.click('[aria-label=Emojis]');
  await audit('09-emojis');
  await page.click('[aria-label=Emojis]');
  const dropSheets = () => page.evaluate(() => document.querySelectorAll('.sheet').forEach((x) => x.remove()));
  await page.click('[aria-label="Menu da conversa"]');
  await page.click('.sheet button:has-text("Participantes e verificação")');
  await page.waitForTimeout(300);
  await audit('09b-participantes');
  await dropSheets();
  await page.click('[aria-label="Menu da conversa"]');
  await page.click('.sheet button:has-text("Mídia, documentos e favoritas")');
  await audit('09c-midia-favoritas');
  await dropSheets();
  await page.click('[aria-label="Anexar foto ou vídeo"]');
  await page.click('.sheet button:has-text("Câmera")');
  await page.waitForFunction(() => document.querySelector('.camera video')?.videoWidth > 0, null, { timeout: 15000 });
  await audit('09d-camera');
  await page.click('.camera button:text-is("Cancelar")');

  // Galeria do navegador (modo máximo desligado) → tela de preparar → editor.
  await page.evaluate(() => globalThis.__mpTest.setPrefs({ maxMode: false }));
  const chooser = page.waitForEvent('filechooser');
  await page.click('[aria-label="Anexar foto ou vídeo"]');
  await page.click('.sheet button:has-text("Galeria")');
  await (await chooser).setFiles(PHOTO);
  await page.waitForSelector('.editor.batch');
  await audit('10-preparar-foto');
  await page.click('.batch >> text=Editar');
  await page.waitForSelector('.editor:not(.batch) .editor-canvas');
  await audit('11-editor');
  await page.click('.editor:not(.batch) >> text=Cancelar');
  await page.click('.batch >> text=Cancelar');

  await page.click('[aria-label=Voltar]');
  // Grupo: enquete criada pelo menu e mostrada na conversa.
  await page.click('.row-btn:has(.title:has-text("Grupo"))');
  await page.click('[aria-label="Menu da conversa"]');
  await page.click('.sheet button:has-text("Criar enquete")');
  await audit('11b-enquete');
  await page.fill('#poll-q', 'Pizza ou sushi?');
  await page.fill('.poll-opt >> nth=0', 'Pizza');
  await page.fill('.poll-opt >> nth=1', 'Sushi');
  await page.click('.sheet button:has-text("Enviar enquete")');
  await page.waitForSelector('.poll');
  await audit('11c-conversa-enquete');
  await page.click('[aria-label=Voltar]');
  await page.click('.row-btn:has(.title:has-text("Grupo"))', { button: 'right' });
  await audit('11d-menu-da-linha');
  await dropSheets();
  await page.click('[aria-label=Ajustes]');
  await page.waitForSelector('text=Trocar de celular');
  await audit('12-ajustes');
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await audit('13-ajustes-fim');
  await page.click('[aria-label=Voltar]');
  await page.click('[aria-label="Novo grupo"]');
  await audit('14-novo-grupo');
  await page.click('[aria-label=Voltar]');
  await page.click('[aria-label=Anotações]');
  await page.fill('#note-text', 'Levar o carregador');
  await page.click('[aria-label="Salvar anotação"]');
  await page.waitForSelector('.msg.mine');
  await audit('15-anotacoes');
  await page.click('[aria-label=Voltar]');
  await page.click('[aria-label=Stories]');
  await audit('16-stories');
  await page.click('[aria-label="Publicar story"]');
  await audit('16b-nova-story');
  await page.click('.sheet button:text-is("Cancelar")');
  await page.click('[aria-label=Voltar]');
  await page.evaluate(() => globalThis.__mpTest.lock('manual'));
  await page.waitForSelector('#secret');
  await audit('17-desbloquear');

  console.log(problems.length ? problems.join('\n') : 'nenhum problema');
  assert.deepEqual(problems.filter((p) => !/pequeno demais/.test(p)), [], 'nada coberto, sem nome ou fora da tela');
});
