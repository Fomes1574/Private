// E2: Hungry Snake, o disfarce. Motor do jogo (regras puras), a porta
// secreta (pausa → segurar 3 s no Recorde → código), as tentativas erradas
// (pausa de 30 min na 4ª; a 5ª apaga, como sempre), a opção em Ajustes,
// botões, conferência visual em pé e deitado, grossura da cobra e custo de
// desenhar. Dados sintéticos; não substitui o teste no celular de verdade.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { startApi, SETUP } from '../../server/test/helpers.mjs';
import { browser, launch, virtualAuthenticator, watchErrors } from '../../e2e/helpers.mjs';
import * as E from '../src/snake/engine.js';

const PORT = 8826;
const APP = `http://localhost:${PORT}`;
const PIN = '284917';
const WRONG = '111111';
const SHOTS = process.env.MP_SHOTS;
const dist = new URL('../dist', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json' };
let api, server, ctx, page, errors, plain;

// ---------- motor ----------
const game = (over = {}) => Object.assign(E.createGame({ random: () => 0 }), over, { state: 'running' });

test('motor: anda, come, cresce e acelera até o limite', () => {
  const g = game();
  g.food = [6, 7];
  assert.equal(E.step(g), 'eat');
  assert.deepEqual(g.snake, [[6, 7], [5, 7], [4, 7], [3, 7]]);
  assert.equal(g.score, 1);
  assert.ok(!g.snake.some((p) => p[0] === g.food[0] && p[1] === g.food[1]), 'maçã nova fora da cobra');
  assert.equal(E.step(g), null);
  assert.equal(g.snake.length, 4);
  assert.equal(E.stepMs({ score: 0, speed: 'normal' }), 135);
  assert.equal(E.stepMs({ score: 1000, speed: 'normal' }), 85);
  assert.ok(E.stepMs({ score: 0, speed: 'slow' }) > E.stepMs({ score: 0, speed: 'fast' }));
});

test('motor: parede mata no clássico; sem paredes atravessa', () => {
  const g = game({ snake: [[14, 7], [13, 7], [12, 7]], food: [0, 0] });
  assert.equal(E.step(g), 'die');
  assert.equal(g.died, 'wall');
  const w = game({ mode: 'wrap', snake: [[14, 7], [13, 7], [12, 7]], food: [0, 0] });
  assert.equal(E.step(w), null);
  assert.deepEqual(w.snake[0], [0, 7]);
});

test('motor: morder o corpo mata; ir para onde a cauda sai não mata', () => {
  const g = game({ snake: [[5, 5], [6, 5], [6, 6], [5, 6], [4, 6]], dir: [0, 1], food: [0, 0] });
  assert.equal(E.step(g), 'die');
  assert.equal(g.died, 'self');
  const t = game({ snake: [[5, 5], [6, 5], [6, 6], [5, 6]], dir: [0, 1], food: [0, 0] });
  assert.equal(E.step(t), null, 'a cauda sai no mesmo passo');
});

test('motor: meia-volta e repetição não entram na fila; fila de até 3', () => {
  const g = game();
  assert.equal(E.turn(g, [-1, 0]), false);
  assert.equal(E.turn(g, [1, 0]), false);
  assert.equal(E.turn(g, [0, -1]), true);
  assert.equal(E.turn(g, [0, 1]), false, 'meia-volta da última virada');
  E.turn(g, [1, 0]); E.turn(g, [0, 1]); E.turn(g, [-1, 0]);
  assert.equal(g.queue.length, 3);
});

test('motor: sem paredes, o desenho vira dois pedaços na borda (sem risco atravessando)', () => {
  const g = game({ mode: 'wrap', snake: [[14, 7], [13, 7], [12, 7]], food: [0, 0] });
  E.step(g);
  const pieces = E.bodyPieces(g, 0.5);
  assert.equal(pieces.length, 2);
  for (const piece of pieces) for (let i = 1; i < piece.length; i++) {
    const [a, b] = [piece[i - 1], piece[i]];
    assert.ok(Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1, `salto dentro do pedaço: ${a} → ${b}`);
  }
  assert.equal(E.bodyPieces(game(), 0.3).length, 1);
});

// ---------- app ----------
before(async () => {
  if (SHOTS) await mkdir(SHOTS, { recursive: true });
  api = await startApi(8827, { appOrigin: APP });
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
after(async () => { await ctx?.close(); await plain?.close(); server?.close(); api?.stop(); });

// IndexedDB simples do app ('mp-app'/'kv'); null apaga a chave.
const kv = (p, op, key, value = null) => p.evaluate(([op, key, value]) => new Promise((res, rej) => {
  const r = indexedDB.open('mp-app', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onerror = () => rej(r.error);
  r.onsuccess = () => {
    const db = r.result, tx = db.transaction('kv', op === 'get' ? 'readonly' : 'readwrite'), st = tx.objectStore('kv');
    let out;
    if (op === 'get') { const q = st.get(key); q.onsuccess = () => { out = q.result; }; } else if (value === null) st.delete(key); else st.put(value, key);
    tx.oncomplete = () => { db.close(); res(out); };
  };
}), [op, key, value]);

async function holdRecord(p, ms) {
  const box = await p.locator('.sn-record').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  await p.waitForTimeout(ms);
  await p.mouse.up();
}
async function typeCode(p, code) {
  for (const d of code) await p.click(`.sn-keypad button[aria-label="${d}"]`);
  await p.click('.sn-keypad button[aria-label="Confirmar"]');
}
const say = (p) => p.textContent('.sn-msg');
const snake = (p, fn, arg) => p.evaluate(fn, arg);
// No jogo não pode aparecer nada do Pacto Talk.
async function looksLikeGame(p) {
  assert.equal(await p.title(), 'Hungry Snake');
  assert.doesNotMatch(await p.evaluate(() => document.body.innerText), /pacto|mensage|conversa|PIN/i);
  assert.equal(await p.$('#secret'), null);
}
async function toPause(p) {
  if (!await p.$('.sn-play')) { await p.click('.sn-home .sn-primary'); await p.waitForSelector('.sn-canvas'); }
  await p.click('[aria-label="Pausar"]');
  await p.waitForSelector('.sn-record');
}

// Mesma régua do teste visual (E4): toque no centro, nome, tamanho, sem sair da tela.
async function audit(p, name) {
  await p.waitForTimeout(300);
  if (SHOTS) await p.screenshot({ path: join(SHOTS, `${name}.png`) });
  return (await p.evaluate(() => {
    const out = [];
    const vw = innerWidth, vh = innerHeight;
    const layer = [...document.querySelectorAll('[aria-modal="true"]')].at(-1) ?? document;
    for (const el of layer.querySelectorAll('button, input:not([type=hidden]), [role=button]')) {
      if (el.closest('[hidden]')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim();
      if (!label) out.push(`sem nome: ${el.className}`);
      if (cx < 0 || cy < 0 || cx > vw || cy > vh) { out.push(`fora da tela: "${label}"`); continue; }
      const hit = document.elementFromPoint(cx, cy);
      if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) out.push(`coberto: "${label}"`);
      if (Math.min(r.width, r.height) < 40) out.push(`pequeno (${Math.round(r.width)}x${Math.round(r.height)}): "${label}"`);
      if (r.right > vw + 1 || r.bottom > vh + 1) out.push(`passa da tela: "${label}"`);
    }
    if (document.documentElement.scrollWidth > vw + 1) out.push('rolagem lateral');
    return out;
  })).map((x) => `${name}: ${x}`);
}

test('Ajustes liga o disfarce; trancar e abrir de novo mostram só o jogo', async () => {
  ctx = await browser();
  page = await ctx.newPage();
  errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await virtualAuthenticator(page);
  await page.goto(`${APP}/#instalar`);
  await page.click('text=Instalar a primeira pessoa');
  await page.fill('#s1', PIN); await page.fill('#s2', PIN); await page.click('form button');
  await page.fill('#token', SETUP); await page.click('text=Entrar');
  await page.fill('#nick', 'Ana'); await page.click('form button'); await page.waitForSelector('#search');

  await page.click('[aria-label=Ajustes]');
  await page.click('#disguise');
  await page.click('.sheet button:has-text("Ligar")');
  await page.waitForFunction(() => document.title === 'Hungry Snake');
  assert.equal(await page.getAttribute('link[rel="apple-touch-icon"]', 'href'), 'snake-180.png');
  assert.equal(await page.getAttribute('link[rel="manifest"]', 'href'), 'snake.webmanifest');
  assert.equal(await kv(page, 'get', 'disguise'), true);

  await page.click('text=Bloquear agora');
  await page.waitForSelector('.sn-home');
  await looksLikeGame(page);
  await page.reload();
  await page.waitForSelector('.sn-home');
  await looksLikeGame(page);
});

test('botões do jogo: som, opções, modo, velocidade, jogar, pausar, continuar, recomeçar', async () => {
  const sound = '.sn-top .sn-icon:first-child';
  assert.equal(await page.getAttribute(sound, 'aria-pressed'), 'true');
  await page.click(sound);
  assert.equal(await page.getAttribute(sound, 'aria-pressed'), 'false');
  await page.click(sound);

  await page.click('[aria-label="Opções"]');
  await page.click('.sn-sheet button:has-text("Setas")');
  await page.click('.sn-sheet button:has-text("Vibração ligada")');
  assert.ok(await page.$('.sn-sheet button:has-text("Vibração desligada")'));
  await page.click('.sn-sheet button:has-text("Fechar")');
  assert.equal(await page.$('.sn-sheet'), null);

  await page.click('button:has-text("Sem paredes")');
  await page.click('button:has-text("Rápida")');
  let prefs = await kv(page, 'get', 'snakePrefs');
  assert.deepEqual([prefs.mode, prefs.speed, prefs.control, prefs.vibrate], ['wrap', 'fast', 'arrows', false]);
  await page.click('button:has-text("Clássico")');
  await page.click('button:has-text("Normal")');

  // Setas na tela: um toque começa a partida.
  await page.click('.sn-home .sn-primary');
  await page.waitForSelector('.sn-pad');
  assert.equal(await snake(page, () => globalThis.__mpSnake.game.state), 'ready');
  await page.dispatchEvent('[aria-label="Cima"]', 'pointerdown');
  assert.equal(await snake(page, () => globalThis.__mpSnake.game.state), 'running');
  await snake(page, () => { const g = globalThis.__mpSnake.game; g.food = [g.snake[0][0], g.snake[0][1] - 1]; });
  await page.waitForFunction(() => globalThis.__mpSnake.game.score === 1);
  assert.equal(await page.textContent('.sn-chip:first-of-type .sn-num'), '1');

  // Pausa congela de verdade (nem desenha).
  await page.click('[aria-label="Pausar"]');
  const frozen = await snake(page, () => [JSON.stringify(globalThis.__mpSnake.game.snake), globalThis.__mpSnake.stats.frames]);
  await page.waitForTimeout(500);
  assert.deepEqual(await snake(page, () => [JSON.stringify(globalThis.__mpSnake.game.snake), globalThis.__mpSnake.stats.frames]), frozen);
  await page.click('.sn-sheet button:has-text("Continuar")');
  assert.equal(await snake(page, () => globalThis.__mpSnake.game.state), 'running');
  // Botão voltar do Android: o app recebe um Esc no window e fecha a pausa.
  await page.keyboard.press('Escape');
  assert.equal(await snake(page, () => globalThis.__mpSnake.game.state), 'paused');
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  assert.equal(await page.$('.sn-sheet'), null);
  await page.keyboard.press('Escape');
  // Controle volta a deslizar pela pausa.
  await page.click('.sn-sheet button:has-text("Deslizar na tela")');
  await page.click('.sn-sheet button:has-text("Vibração desligada")');
  await page.click('.sn-sheet button:has-text("Recomeçar")');
  assert.deepEqual(await snake(page, () => [globalThis.__mpSnake.game.state, globalThis.__mpSnake.game.score]), ['ready', 0]);
  assert.ok(await page.$('.sn-hint'));

  // Deslizar no tabuleiro começa e vira.
  const box = await page.locator('.sn-stage').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 140, { steps: 4 });
  await page.mouse.up();
  await page.waitForFunction(() => globalThis.__mpSnake.game.dir[1] === 1);
  assert.equal(await snake(page, () => globalThis.__mpSnake.game.state), 'running');

  // Teclado: setas viram; bater na parede leva ao fim de jogo.
  await page.keyboard.press('ArrowLeft');
  await page.waitForSelector('.sn-over', { timeout: 15000 });
  assert.match(await page.textContent('.sn-over'), /Fim de jogo/);
  await page.click('.sn-over button:has-text("Jogar de novo")');
  await page.waitForSelector('.sn-canvas');
  await page.click('[aria-label="Pausar"]');
  await page.click('.sn-sheet button:has-text("Voltar ao início")');
  await page.waitForSelector('.sn-home');
  assert.deepEqual(errors, []);
});

test('porta secreta: toque curto não abre; 3 s no Recorde abre o código; seta volta ao jogo', async () => {
  await toPause(page);
  await holdRecord(page, 1200);
  assert.equal(await page.$('.sn-code'), null);
  await holdRecord(page, 3300);
  await page.waitForSelector('.sn-code');
  assert.match(await page.textContent('.sn-code'), /Código de contribuidor/);
  await page.click('.sn-code [aria-label="Voltar"]');
  await page.waitForSelector('.sn-record');
  assert.equal(await page.$('.sn-code'), null);
  assert.equal(await snake(page, () => globalThis.__mpSnake.game.state), 'ready');
});

test('código: formato errado não conta; 4 erros pausam o Recorde; PIN certo entra e zera', async () => {
  await holdRecord(page, 3300);
  await page.waitForSelector('.sn-code');
  await typeCode(page, '123');
  assert.equal(await say(page), 'Código incompleto');
  assert.equal(await kv(page, 'get', 'snakeHold'), undefined);
  for (let i = 1; i <= 3; i++) {
    await typeCode(page, WRONG);
    await page.waitForFunction(() => document.querySelector('.sn-msg')?.textContent === 'Código inválido');
    assert.equal((await kv(page, 'get', 'snakeHold')).wrong, i);
    assert.doesNotMatch(await page.textContent('.sn-code'), /resta|tentativa/i);
  }
  await typeCode(page, WRONG);
  await page.waitForSelector('.sn-record', { timeout: 10000 }); // volta sozinho ao jogo
  const hold = await kv(page, 'get', 'snakeHold');
  assert.ok(hold.until > Date.now() + 29 * 60_000 && hold.until <= Date.now() + 30 * 60_000);
  await holdRecord(page, 3300);
  await page.waitForTimeout(400);
  assert.equal(await page.$('.sn-code'), null, 'Recorde não responde durante a pausa');

  // Passados os 30 min, o PIN certo entra e zera a contagem.
  await kv(page, 'put', 'snakeHold', { wrong: 0, until: Date.now() - 1000 });
  await holdRecord(page, 3300);
  await page.waitForSelector('.sn-code');
  await typeCode(page, PIN);
  await page.waitForSelector('#search', { timeout: 60000 });
  assert.equal(await kv(page, 'get', 'snakeHold'), undefined);
});

test('desligar o disfarce volta ao desbloqueio normal; religar volta ao jogo', async () => {
  await page.click('[aria-label=Ajustes]');
  assert.equal(await page.isChecked('#disguise'), true);
  await page.click('#disguise');
  await page.waitForFunction(() => document.title === 'Pacto Talk');
  await page.click('text=Bloquear agora');
  await page.waitForSelector('#secret');
  await page.fill('#secret', PIN);
  await page.click('form button');
  await page.waitForSelector('#search', { timeout: 60000 });
  await page.click('[aria-label=Ajustes]');
  await page.click('#disguise');
  await page.click('.sheet button:has-text("Ligar")');
  await page.click('text=Bloquear agora');
  await page.waitForSelector('.sn-home');
  await looksLikeGame(page);
});

// Sair do app (outro app, tela inicial) e voltar, sem esperar.
const leave = (p) => p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
const back = (p, awayMs = 0) => p.evaluate((ms) => {
  // Simula o tempo fora do app adiantando o relógio só para esta volta.
  const real = Date.now;
  if (ms) Date.now = () => real() + ms;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  document.dispatchEvent(new Event('visibilitychange'));
  Date.now = real;
}, awayMs);
async function enterByDoor(p) {
  await toPause(p);
  await holdRecord(p, 3300);
  await p.waitForSelector('.sn-code');
  await typeCode(p, PIN);
  await p.waitForSelector('#search', { timeout: 60000 });
}

test('sair e voltar logo (ver o WhatsApp) já cai no jogo; com "trancar depois de 1 minuto", só depois do prazo', async () => {
  await enterByDoor(page);
  await leave(page);
  await page.waitForSelector('.sn-home');
  await back(page, 5_000);
  await page.waitForTimeout(300);
  assert.ok(await page.$('.sn-home'), 'voltou em 5 s e está no jogo');
  assert.equal(await page.$('#search'), null);
  await looksLikeGame(page);

  // Quem escolheu "Depois de 1 minuto" volta direto se for rápido.
  await enterByDoor(page);
  await page.click('[aria-label=Ajustes]');
  await page.selectOption('#lock-after', '60000');
  await page.click('[aria-label=Voltar]');
  await page.waitForSelector('#search');
  await leave(page);
  await back(page, 20_000);
  await page.waitForTimeout(500);
  assert.ok(await page.$('#search'), 'voltou em 20 s: conversas abertas');
  await leave(page);
  await back(page, 61_000);
  await page.waitForSelector('.sn-home');
  await looksLikeGame(page);

  // Volta ao padrão (tranca na hora).
  await enterByDoor(page);
  await page.click('[aria-label=Ajustes]');
  await page.selectOption('#lock-after', '0');
  await page.click('text=Bloquear agora');
  await page.waitForSelector('.sn-home');
});

test('5 erros seguidos ainda apagam: volta ao jogo em silêncio, disfarce fica', async () => {
  await kv(page, 'put', 'snakeBest', 7);
  await toPause(page);
  await holdRecord(page, 3300);
  await page.waitForSelector('.sn-code');
  for (let i = 0; i < 3; i++) {
    await typeCode(page, WRONG);
    await page.waitForFunction(() => document.querySelector('.sn-msg')?.textContent === 'Código inválido');
  }
  await typeCode(page, WRONG);
  await page.waitForSelector('.sn-record', { timeout: 10000 });
  await kv(page, 'put', 'snakeHold', { wrong: 0, until: Date.now() - 1000 });
  await holdRecord(page, 3300);
  await page.waitForSelector('.sn-code');
  await typeCode(page, WRONG); // 5ª seguida no servidor
  await page.waitForSelector('.sn-home', { timeout: 60000 });
  await looksLikeGame(page);
  assert.equal(await kv(page, 'get', 'vault'), undefined, 'cofre apagado');
  assert.equal(await kv(page, 'get', 'disguise'), true, 'disfarce continua');
  assert.equal(await kv(page, 'get', 'snakeBest'), 7, 'recorde continua');
  // Sem cofre, a porta leva ao começo do Pacto Talk.
  await toPause(page);
  await holdRecord(page, 3300);
  await page.waitForSelector('.brand-name');
  assert.equal(await page.textContent('.brand-name'), 'Pacto Talk');
  assert.deepEqual(errors.filter((e) => !/401|403|410|Failed to load resource/.test(e)), []);
});

// ---------- visual, grossura e desempenho (sem servidor: só o jogo) ----------
async function gamePage(width, height, dpr) {
  const c = await plain.newContext({ viewport: { width, height }, deviceScaleFactor: dpr });
  const p = await c.newPage();
  const errs = watchErrors(p);
  await p.goto(`${APP}/`);
  await kv(p, 'put', 'disguise', true);
  await kv(p, 'put', 'vault', { wrapped: 'teste', mode: 'passkey' }); // só para a porta abrir o teclado
  await kv(p, 'put', 'snakeBest', 42);
  await p.reload();
  await p.waitForSelector('.sn-home');
  return { c, p, errs };
}

test('conferência visual: em pé, deitado e celular pequeno, todo botão alcançável', async () => {
  plain = await launch();
  const problems = [];
  for (const [tag, w, h] of [['em-pe', 390, 844], ['deitado', 844, 390], ['pequeno', 360, 640], ['pequeno-deitado', 640, 360]]) {
    const { c, p, errs } = await gamePage(w, h, 2);
    problems.push(...await audit(p, `${tag}-1-inicio`));
    await p.click('[aria-label="Opções"]');
    problems.push(...await audit(p, `${tag}-2-opcoes`));
    await p.click('.sn-sheet button:has-text("Setas")');
    await p.click('.sn-sheet button:has-text("Fechar")');
    await p.click('.sn-home .sn-primary');
    await p.waitForSelector('.sn-pad');
    problems.push(...await audit(p, `${tag}-3-setas`));
    await p.click('[aria-label="Pausar"]');
    problems.push(...await audit(p, `${tag}-4-pausa`));
    await holdRecord(p, 3300);
    await p.waitForSelector('.sn-code');
    problems.push(...await audit(p, `${tag}-5-codigo`));
    await p.click('.sn-code [aria-label="Voltar"]');
    await p.click('.sn-sheet button:has-text("Continuar")');
    await p.dispatchEvent('[aria-label="Cima"]', 'pointerdown');
    await p.waitForSelector('.sn-over', { timeout: 15000 });
    problems.push(...await audit(p, `${tag}-6-fim`));
    // O tabuleiro cabe inteiro e é quadrado.
    await p.click('.sn-over .sn-primary');
    const b = await p.locator('.sn-board').boundingBox();
    assert.ok(Math.abs(b.width - b.height) < 1 && b.x >= 0 && b.y >= 0 && b.x + b.width <= w && b.y + b.height <= h, `${tag}: tabuleiro ${JSON.stringify(b)}`);
    assert.deepEqual(errs, [], tag);
    await c.close();
  }
  assert.deepEqual(problems, []);
});

test('a cobra tem a mesma grossura na horizontal e na vertical (1x, 2x, 3x; em pé e deitado)', async () => {
  for (const [w, h, dpr] of [[390, 844, 1], [390, 844, 2], [393, 852, 3], [844, 390, 3], [412, 915, 2.625]]) {
    const { c, p } = await gamePage(w, h, dpr);
    await p.click('.sn-home .sn-primary');
    await p.waitForSelector('.sn-canvas');
    const r = await p.evaluate(() => {
      const { game: g, paint } = globalThis.__mpSnake;
      // Em L: horizontal de (2,3) a (10,3), depois vertical até (10,12).
      const body = [];
      for (let y = 12; y >= 4; y--) body.push([10, y]);
      for (let x = 10; x >= 2; x--) body.push([x, 3]);
      g.snake = body; g.prev = body.map((q) => q.slice()); g.dir = [0, 1]; g.food = [0, 14]; g.state = 'paused';
      paint();
      const cv = document.querySelector('.sn-canvas'), W = cv.width, cell = Math.floor(W / 15), off = Math.floor((W - cell * 15) / 2);
      const img = cv.getContext('2d').getImageData(0, 0, W, W).data;
      const blue = (x, y) => { const i = (y * W + x) * 4; return img[i + 2] > 180 && img[i] < 110; };
      const mid = (k) => off + k * cell + Math.floor(cell / 2);
      let across = 0, down = 0;
      for (let y = 0; y < W; y++) if (blue(mid(6), y)) across++; // corta o trecho horizontal
      for (let x = 0; x < W; x++) if (blue(x, mid(8))) down++; // corta o trecho vertical
      return { across, down, cell };
    });
    assert.equal(r.across, r.down, `${w}x${h}@${dpr}: ${JSON.stringify(r)}`);
    assert.ok(r.across >= r.cell * 0.7, `${w}x${h}@${dpr}: grossura ${r.across} para casa ${r.cell}`);
    await c.close();
  }
});

test('desempenho: desenhar um quadro custa pouco, mesmo com cobra comprida', async () => {
  const { c, p } = await gamePage(390, 844, 3);
  await p.click('button:has-text("Sem paredes")');
  await p.click('.sn-home .sn-primary');
  await p.waitForSelector('.sn-canvas');
  await p.keyboard.press('ArrowUp');
  const r = await p.evaluate(async () => {
    const { game: g, stats } = globalThis.__mpSnake;
    // Cobra de 113 casas em zigue-zague; a coluna 0 fica livre para ela subir.
    const body = [];
    for (let i = 0; i < 8; i++) for (let k = 0; k < 14; k++) body.push([i % 2 ? 14 - k : 1 + k, 14 - i]);
    g.snake = [[0, 7], ...body.reverse()]; g.prev = g.snake.map((q) => q.slice()); g.dir = [0, -1]; g.queue = []; g.food = [7, 3]; g.speed = 'slow';
    Object.assign(stats, { frames: 0, drawMs: 0, worstMs: 0 });
    const long = [];
    const obs = new PerformanceObserver((l) => long.push(...l.getEntries().map((e) => e.duration)));
    try { obs.observe({ type: 'longtask' }); } catch {}
    const gaps = []; let last = performance.now();
    await new Promise((res) => { const tick = (t) => { gaps.push(t - last); last = t; if (gaps.length < 120) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
    obs.disconnect();
    gaps.sort((a, b) => a - b);
    return { frames: stats.frames, avg: stats.drawMs / stats.frames, worst: stats.worstMs, p95: gaps[Math.floor(gaps.length * 0.95)], long, state: g.state };
  });
  console.log(`desenho: média ${r.avg.toFixed(2)} ms, pior ${r.worst.toFixed(2)} ms, intervalo p95 ${r.p95.toFixed(1)} ms, ${r.frames} quadros`);
  assert.equal(r.state, 'running');
  assert.ok(r.frames > 60);
  assert.ok(r.avg < 4, `média ${r.avg}`);
  assert.ok(r.worst < 16, `pior ${r.worst}`);
  assert.equal(r.long.filter((d) => d > 100).length, 0, `tarefas longas: ${r.long}`);
  await c.close();
});
