// Hungry Snake (E2): o disfarce do app. É um jogo da cobrinha de verdade.
// O caminho para as conversas: pausar e segurar 3 s no Recorde, o que abre
// "Código de contribuidor"; lá vai o PIN. Nada na tela indica isso.
import { h, mount } from '../ui.js';
import * as session from '../session.js';
import { WrongSecretError, VaultWipedError, OfflineError } from '../vault/vault.js';
import * as E from '../snake/engine.js';
import { createBoard } from '../snake/board.js';
import * as store from '../snake/store.js';
import { enterApp } from './unlock.js';
import { CONFIG } from '../config.js';

export const SECRET_HOLD_MS = 3000;
const SWIPE_PX = 22;

// ---------- desenhos (SVG montado elemento a elemento) ----------
const NS = 'http://www.w3.org/2000/svg';
function svg(size, view, parts, label) {
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('width', size); el.setAttribute('height', size); el.setAttribute('viewBox', view);
  if (label) { el.setAttribute('role', 'img'); el.setAttribute('aria-label', label); } else el.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of parts) {
    const p = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) p.setAttribute(k, v);
    el.append(p);
  }
  return el;
}
const line = (d, w = 2.6) => ['path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }];
const I = {
  apple: (s = 22) => svg(s, '0 0 24 24', [['circle', { cx: 12, cy: 14, r: 7.5, fill: '#E7471D' }], ['path', { d: 'M12 7 q1 -3 3 -4', stroke: '#5D4037', 'stroke-width': 1.8, fill: 'none', 'stroke-linecap': 'round' }], ['path', { d: 'M13.5 5 q4 -3 7 -0.5 q-3.5 3 -7 0.5z', fill: '#43A047' }]]),
  trophy: (s = 20) => svg(s, '0 0 24 24', [['path', { d: 'M7 4h10v4a5 5 0 0 1-10 0z', fill: '#FFD54A' }], ['path', { d: 'M11 13h2v4h-2zM8 19h8v2H8z', fill: '#FFD54A' }], ['path', { d: 'M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3', fill: 'none', stroke: '#FFD54A', 'stroke-width': 2 }]]),
  pause: () => svg(22, '0 0 24 24', [['rect', { x: 6, y: 5, width: 4, height: 14, rx: 1.5, fill: 'currentColor' }], ['rect', { x: 14, y: 5, width: 4, height: 14, rx: 1.5, fill: 'currentColor' }]]),
  soundOn: () => svg(22, '0 0 24 24', [line('M4 10v4h4l5 4V6L8 10z', 2.2), line('M16 9a4 4 0 0 1 0 6', 2.2)]),
  soundOff: () => svg(22, '0 0 24 24', [line('M4 10v4h4l5 4V6L8 10z', 2.2), line('M16 10l4 4M20 10l-4 4', 2.2)]),
  menu: () => svg(22, '0 0 24 24', [line('M4 7h16M4 12h16M4 17h16', 2.2)]),
  back: () => svg(22, '0 0 24 24', [line('M15 6l-6 6 6 6')]),
  up: () => svg(26, '0 0 24 24', [line('M6 15l6-6 6 6', 2.8)]),
  down: () => svg(26, '0 0 24 24', [line('M6 9l6 6 6-6', 2.8)]),
  left: () => svg(26, '0 0 24 24', [line('M15 6l-6 6 6 6', 2.8)]),
  right: () => svg(26, '0 0 24 24', [line('M9 6l6 6-6 6', 2.8)]),
};
const SNAKE_PATH = 'M18 92 C18 70 40 70 52 70 C70 70 70 46 52 40 C40 36 38 22 54 20 L74 20';
export const appIcon = (s) => svg(s, '0 0 120 120', [
  ['rect', { width: 120, height: 120, fill: '#7CB342' }],
  ['path', { d: 'M0 0h30v30H0zM60 0h30v30H60zM30 30h30v30H30zM90 30h30v30H90zM0 60h30v30H0zM60 60h30v30H60zM30 90h30v30H30zM90 90h30v30H90z', fill: '#8BC34A' }],
  ['path', { d: SNAKE_PATH, fill: 'none', stroke: '#2F5FD0', 'stroke-width': 22, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }],
  ['path', { d: SNAKE_PATH, fill: 'none', stroke: '#4E7CF6', 'stroke-width': 16, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }],
  ['circle', { cx: 72, cy: 15, r: 5, fill: '#FFFFFF' }], ['circle', { cx: 73.5, cy: 15, r: 2.4, fill: '#1B1B1B' }],
  ['circle', { cx: 72, cy: 26, r: 5, fill: '#FFFFFF' }], ['circle', { cx: 73.5, cy: 26, r: 2.4, fill: '#1B1B1B' }],
  ['circle', { cx: 94, cy: 84, r: 16, fill: '#E7471D' }],
  ['ellipse', { cx: 88, cy: 78, rx: 5, ry: 3.5, fill: '#FF8A65', opacity: 0.85 }],
  ['path', { d: 'M94 68 q1 -7 6 -9', stroke: '#5D4037', 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' }],
  ['path', { d: 'M97 63 q8 -6 14 -1 q-7 6 -14 1z', fill: '#43A047' }],
]);
const dizzy = () => svg(150, '0 0 150 100', [
  ['path', { d: 'M14 78 h44 v-32 h44', fill: 'none', stroke: '#2F5FD0', 'stroke-width': 26, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }],
  ['path', { d: 'M14 78 h44 v-32 h44', fill: 'none', stroke: '#4E7CF6', 'stroke-width': 20, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }],
  ['path', { d: 'M98 36 l7 7 M105 36 l-7 7 M98 50 l7 7 M105 50 l-7 7', stroke: '#1B1B1B', 'stroke-width': 3, 'stroke-linecap': 'round' }],
  ['rect', { x: 124, y: 14, width: 10, height: 72, rx: 3, fill: '#8D6E63' }],
  ['path', { d: 'M118 22 l8 -4 M120 30 l6 -2', stroke: '#FFD54A', 'stroke-width': 3, 'stroke-linecap': 'round' }],
]);

// ---------- som e vibração ----------
// Mordida gerada na hora (dois estalos curtos de ruído filtrado): nenhum
// arquivo de áudio. O áudio só começa depois de um toque.
let audio = null;
function wakeAudio() {
  try {
    const A = window.AudioContext || window.webkitAudioContext;
    if (!A) return;
    audio ??= new A();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
  } catch {}
}
function bite() {
  if (!audio) return;
  try {
    const sr = audio.sampleRate, len = Math.floor(sr * 0.12);
    const buf = audio.createBuffer(1, len, sr), data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const p = i / len, k = p < 0.35 ? 1 - p / 0.35 : p > 0.45 && p < 0.8 ? 0.7 * (1 - (p - 0.45) / 0.35) : 0;
      data[i] = (Math.random() * 2 - 1) * k * k;
    }
    const src = audio.createBufferSource(); src.buffer = buf;
    const bp = audio.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 0.8;
    const gain = audio.createGain(); gain.gain.value = 0.55;
    src.connect(bp); bp.connect(gain); gain.connect(audio.destination);
    src.start();
  } catch {}
}
const buzz = (ms) => { try { navigator.vibrate?.(ms); } catch {} };

// Segurar parado por `ms` (o dedo pode tremer um pouco). Não mostra nada
// enquanto segura.
function holdFor(el, ms, fn) {
  let timer = null, x = 0, y = 0;
  const stop = () => { clearTimeout(timer); timer = null; };
  el.classList.add('sn-hold');
  el.addEventListener('pointerdown', (e) => {
    x = e.clientX; y = e.clientY; stop();
    // Capturado: o quadro pode se mexer (folha subindo) sem soltar o dedo.
    try { el.setPointerCapture(e.pointerId); } catch {}
    timer = setTimeout(() => { timer = null; if (el.isConnected) fn(); }, ms);
  });
  el.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - x, e.clientY - y) > 24) stop(); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, stop);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

function segmented(label, options, value, pick) {
  const buttons = options.map(([v, text]) => h('button', { type: 'button', 'aria-pressed': String(v === value), text, onclick: () => {
    for (const b of buttons) b.setAttribute('aria-pressed', String(b === buttons[options.findIndex((o) => o[0] === v)]));
    pick(v);
  } }));
  return h('div', { class: `sn-seg n${options.length}`, role: 'group', 'aria-label': label }, buttons);
}

function toggle(onText, offText, get, set) {
  const b = h('button', { type: 'button', class: 'sn-toggle', onclick: () => { set(!get()); paint(); } });
  const paint = () => { b.textContent = get() ? onText : offText; b.setAttribute('aria-pressed', String(get())); };
  paint();
  return b;
}

const DIRS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };

let latest = null;
export async function snakeScreen(go) {
  const mine = Symbol('snake');
  latest = mine;
  const prefs = await store.loadPrefs();
  let best = await store.loadBest(), bestBefore = best;
  const game = E.createGame({ mode: prefs.mode, speed: prefs.speed });
  const root = h('div', { class: 'snake' });
  const save = () => store.savePrefs(prefs);
  let view = null, sheet = null, raf = 0, last = 0, acc = 0, alive = true, ro = null, dieTimer = 0;
  let board = null, boardBox = null, stage = null, ready = null, scoreEl = null, bestEl = null, ctrl = null, paintSound = null;
  const offs = [];
  // Só em build de teste: o estado do jogo e o custo de desenhar cada quadro.
  const stats = { frames: 0, drawMs: 0, worstMs: 0 };
  const listen = (target, ev, fn) => { target.addEventListener(ev, fn); offs.push(() => target.removeEventListener(ev, fn)); };


  function show(node, name) {
    view = name;
    stopLoop(); clearTimeout(dieTimer);
    ro?.disconnect(); ro = null;
    closeSheet();
    root.className = `snake ${name}`;
    root.replaceChildren(node);
  }
  function closeSheet() { sheet?.remove(); sheet = null; root.removeAttribute('data-back'); }
  function openSheet(label, ...children) {
    closeSheet();
    sheet = h('div', { class: 'sn-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': label }, h('div', { class: 'sn-sheet-box' }, children));
    root.append(sheet);
    root.setAttribute('data-back', ''); // botão voltar do Android fecha a folha
  }
  const keepBest = () => { if (game.score > best) { best = game.score; store.saveBest(best); } };

  // ---------- início ----------
  function home() {
    const sound = h('button', { type: 'button', class: 'sn-icon', onclick: () => { prefs.sound = !prefs.sound; save(); paintSound(); if (prefs.sound) wakeAudio(); } });
    paintSound = () => { sound.replaceChildren(prefs.sound ? I.soundOn() : I.soundOff()); sound.setAttribute('aria-label', prefs.sound ? 'Som ligado' : 'Som desligado'); sound.setAttribute('aria-pressed', String(prefs.sound)); };
    paintSound();
    show(h('div', { class: 'sn-home' },
      h('div', { class: 'sn-top' }, sound, h('button', { type: 'button', class: 'sn-icon', 'aria-label': 'Opções', onclick: options }, I.menu())),
      h('div', { class: 'sn-brand' }, h('span', { class: 'sn-appicon' }, appIcon(112)), h('h1', { text: 'Hungry Snake' })),
      record(h('div', { class: 'sn-pill' }, I.trophy(22), h('span', { text: `Recorde ${best}` }))),
      h('div', { class: 'sn-actions' },
        h('button', { type: 'button', class: 'sn-primary big', text: 'Jogar', onclick: () => { wakeAudio(); play(true); } }),
        segmented('Modo', [['classic', 'Clássico'], ['wrap', 'Sem paredes']], prefs.mode, (v) => { prefs.mode = v; save(); }),
        segmented('Velocidade', [['slow', 'Lenta'], ['normal', 'Normal'], ['fast', 'Rápida']], prefs.speed, (v) => { prefs.speed = v; save(); }))), 'home');
  }

  function options() {
    openSheet('Opções',
      h('h2', { text: 'Opções' }),
      h('div', { class: 'sn-field' }, h('span', { text: 'Controle' }), segmented('Controle', [['swipe', 'Deslizar na tela'], ['arrows', 'Setas']], prefs.control, (v) => { prefs.control = v; save(); })),
      h('div', { class: 'sn-pair' },
        toggle('Som ligado', 'Som desligado', () => prefs.sound, (v) => { prefs.sound = v; save(); paintSound?.(); }),
        toggle('Vibração ligada', 'Vibração desligada', () => prefs.vibrate, (v) => { prefs.vibrate = v; save(); })),
      h('p', { class: 'sn-about', text: 'Hungry Snake · Little Fern Games' }),
      h('button', { type: 'button', class: 'sn-soft', text: 'Fechar', onclick: closeSheet }));
  }

  // ---------- partida ----------
  function play(fresh) {
    if (fresh) { E.reset(game); game.mode = prefs.mode; game.speed = prefs.speed; acc = 0; bestBefore = best; }
    const canvas = h('canvas', { class: 'sn-canvas', 'aria-label': 'Tabuleiro' });
    board = createBoard(canvas);
    ready = h('div', { class: 'sn-ready' },
      h('p', { text: prefs.control === 'arrows' ? 'Toque numa seta ou em Começar' : 'Deslize ou toque em Começar' }),
      h('button', { type: 'button', class: 'sn-primary', text: 'Começar', onclick: () => { wakeAudio(); start(); } }));
    ready.hidden = game.state !== 'ready';
    boardBox = h('div', { class: `sn-board${game.mode === 'wrap' ? ' wrap' : ''}` }, canvas, ready);
    stage = h('div', { class: 'sn-stage' }, boardBox);
    swipe(stage);
    scoreEl = h('span', { class: 'sn-num', text: String(game.score) });
    bestEl = h('span', { class: 'sn-num', text: String(Math.max(best, game.score)) });
    ctrl = h('div', { class: 'sn-ctrl' });
    renderCtrl();
    show(h('div', { class: 'sn-play' },
      h('div', { class: 'sn-hud' },
        h('span', { class: 'sn-title', text: 'Hungry Snake' }),
        h('div', { class: 'sn-chip', 'aria-label': 'Maçãs' }, I.apple(22), scoreEl),
        record(h('div', { class: 'sn-chip', 'aria-label': 'Recorde' }, I.trophy(20), bestEl)),
        h('button', { type: 'button', class: 'sn-icon', 'aria-label': 'Pausar', onclick: pause }, I.pause())),
      stage, ctrl), 'play');
    ro = new ResizeObserver(fit);
    ro.observe(stage);
    fit();
    if (game.state === 'running') startLoop();
  }

  function renderCtrl() {
    if (!ctrl) return;
    const pad = (name, label, d) => h('button', { type: 'button', class: `sn-arrow ${name}`, 'aria-label': label, onpointerdown: (e) => { e.preventDefault(); wakeAudio(); turnTo(d); } }, I[name]());
    ctrl.replaceChildren(prefs.control === 'arrows'
      ? h('div', { class: 'sn-pad' }, pad('up', 'Cima', [0, -1]), pad('left', 'Esquerda', [-1, 0]), pad('down', 'Baixo', [0, 1]), pad('right', 'Direita', [1, 0]))
      : h('p', { class: 'sn-hint', text: 'Deslize o dedo no tabuleiro para virar' }));
    if (ready && !ready.hidden) ready.firstChild.textContent = prefs.control === 'arrows' ? 'Toque numa seta ou em Começar' : 'Deslize ou toque em Começar';
  }

  function fit() {
    if (!stage || !board) return;
    const s = Math.floor(Math.min(stage.clientWidth, stage.clientHeight));
    if (s <= 0) return;
    boardBox.style.width = boardBox.style.height = `${s}px`;
    board.resize(s);
    paintBoard(performance.now());
  }

  function swipe(el) {
    let origin = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      wakeAudio(); origin = [e.clientX, e.clientY];
      el.setPointerCapture?.(e.pointerId);
    });
    const move = (e) => {
      if (!origin) return;
      const dx = e.clientX - origin[0], dy = e.clientY - origin[1];
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return;
      turnTo(Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)]);
      origin = [e.clientX, e.clientY];
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', (e) => { move(e); origin = null; });
    el.addEventListener('pointercancel', () => { origin = null; });
  }

  function turnTo(d) {
    if (view !== 'play' || sheet || game.state === 'over' || game.state === 'paused') return;
    E.turn(game, d);
    if (game.state === 'ready') start();
  }
  function start() {
    if (game.state !== 'ready') return;
    game.state = 'running';
    ready.hidden = true;
    startLoop();
  }
  function startLoop() { if (raf || !alive) return; last = performance.now(); raf = requestAnimationFrame(frame); }
  function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  const progress = () => (game.state === 'over' ? 1 : Math.min(1, acc / E.stepMs(game)));
  const paintBoard = (now) => board?.draw(game, progress(), now);

  function frame(now) {
    raf = 0;
    if (!alive || view !== 'play') return;
    const dt = Math.min(64, now - last); last = now;
    if (game.state === 'running') {
      acc += dt;
      while (acc >= E.stepMs(game)) {
        acc -= E.stepMs(game);
        const r = E.step(game);
        if (r === 'eat') eaten();
        if (r === 'die') { acc = 0; died(); break; }
      }
    }
    const t0 = performance.now();
    paintBoard(now);
    const spent = performance.now() - t0;
    stats.frames += 1; stats.drawMs += spent; stats.worstMs = Math.max(stats.worstMs, spent);
    if (game.state === 'running' || board.busy()) raf = requestAnimationFrame(frame);
  }

  function eaten() {
    board.burst(game.snake[0]);
    if (prefs.sound) bite();
    if (prefs.vibrate) buzz(12);
    keepBest();
    scoreEl.textContent = String(game.score);
    bestEl.textContent = String(best);
  }
  function died() {
    if (prefs.vibrate) buzz(70);
    keepBest();
    boardBox.classList.add('hit');
    dieTimer = setTimeout(() => { if (alive && view === 'play') over(); }, 750);
  }

  function pause() {
    if (view !== 'play' || sheet || game.state === 'over') return;
    if (game.state === 'running') game.state = 'paused';
    stopLoop();
    paintBoard(performance.now());
    const tile = record(h('div', { class: 'sn-tile sn-record' }, h('span', { text: 'Recorde' }), h('strong', { text: String(best) })));
    openSheet('Pausado',
      h('h2', { text: 'Pausado' }),
      h('div', { class: 'sn-tiles' }, h('div', { class: 'sn-tile' }, h('span', { text: 'Maçãs' }), h('strong', { text: String(game.score) })), tile),
      h('button', { type: 'button', class: 'sn-primary', text: 'Continuar', onclick: resume }),
      h('button', { type: 'button', class: 'sn-soft', text: 'Recomeçar', onclick: () => play(true) }),
      h('div', { class: 'sn-field' }, h('span', { text: 'Controle' }), segmented('Controle', [['swipe', 'Deslizar na tela'], ['arrows', 'Setas']], prefs.control, (v) => { prefs.control = v; save(); renderCtrl(); })),
      h('div', { class: 'sn-pair' },
        toggle('Som ligado', 'Som desligado', () => prefs.sound, (v) => { prefs.sound = v; save(); }),
        toggle('Vibração ligada', 'Vibração desligada', () => prefs.vibrate, (v) => { prefs.vibrate = v; save(); })),
      h('button', { type: 'button', class: 'sn-link', text: 'Voltar ao início', onclick: home }));
  }
  function resume() {
    closeSheet();
    wakeAudio();
    if (game.state === 'paused') { game.state = 'running'; startLoop(); }
  }

  // ---------- fim de jogo ----------
  function over() {
    const s = game.score, won = game.died === 'full';
    const gap = bestBefore - s;
    const note = gap < 0 ? 'Novo recorde!' : gap === 0 ? (s ? 'Igualou o recorde' : null) : gap === 1 ? 'Faltou 1 para o recorde' : `Faltaram ${gap} para o recorde`;
    show(h('div', { class: 'sn-over' },
      h('div', { class: 'sn-over-head' },
        dizzy(),
        h('h1', { text: won ? 'Tabuleiro cheio!' : 'Fim de jogo' }),
        h('p', { text: won ? 'Não cabe mais nada' : game.died === 'wall' ? 'Bateu na cerca' : 'Mordeu o próprio rabo' })),
      h('div', { class: 'sn-over-body' },
        h('div', { class: 'sn-tiles' },
          h('div', { class: 'sn-tile' }, h('span', { text: 'Maçãs' }), h('strong', { text: String(s) })),
          record(h('div', { class: 'sn-tile' }, h('span', { text: 'Recorde' }), h('strong', { text: String(best) })))),
        note ? h('p', { class: 'sn-note', text: note }) : null,
        h('button', { type: 'button', class: 'sn-primary big', text: 'Jogar de novo', onclick: () => play(true) }),
        h('button', { type: 'button', class: 'sn-ghost', text: 'Início', onclick: home }))), 'over');
  }

  // ---------- código de contribuidor (a porta) ----------
  // Todo "Recorde" é porta: no início, no placar da partida, na pausa e no fim.
  const record = (el) => { holdFor(el, SECRET_HOLD_MS, door); return el; };
  let from = 'home';
  async function door() {
    if (!alive || view === 'code') return;
    // Segurar durante a partida: a cobra para enquanto o código está aberto.
    if (view === 'play' && game.state === 'running') { game.state = 'paused'; stopLoop(); }
    if (await store.holdActive()) return;
    from = view;
    const rec = await session.vaultStore.load();
    // Sem cofre: não há o que abrir; vai para o começo do Pacto Talk.
    if (!rec?.wrapped) { if (rec) await session.wipeEverything().catch(() => {}); return go('welcome', { door: true }); }
    code(rec.mode === 'passkey');
  }

  function code(pin) {
    session.prewarm();
    let digits = '', busy = false;
    const msg = h('p', { class: 'sn-msg', role: 'status', 'aria-live': 'polite' });
    const say = (t) => { msg.textContent = t; };
    const dots = h('div', { class: 'sn-dots', role: 'img' });
    const paintDots = () => {
      const n = Math.max(6, digits.length);
      dots.replaceChildren(...Array.from({ length: n }, (_, i) => h('span', { class: i < digits.length ? 'on' : '' })));
      dots.setAttribute('aria-label', `${digits.length} dígitos`);
    };
    const text = h('input', { class: 'sn-input', type: 'password', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Código', placeholder: 'Código' });
    const keys = [];
    const press = (k) => {
      if (busy) return;
      say('');
      if (k === 'del') digits = digits.slice(0, -1);
      else if (k === 'ok') return submit(digits);
      else if (digits.length < 12) digits += k;
      paintDots();
    };
    const setBusy = (v) => { busy = v; for (const b of keys) b.disabled = v; text.disabled = v; };
    // A seta volta para onde a pessoa estava (início, partida pausada ou fim).
    const back = () => { if (busy) return; if (from === 'home') home(); else if (from === 'over') over(); else { play(false); pause(); } };

    async function submit(secret) {
      if (busy) return;
      if (pin ? !/^\d{6,12}$/.test(secret) : !secret.trim()) return say('Código incompleto');
      setBusy(true); say('Verificando…');
      try {
        const r = await session.unlock(secret);
        await store.clearWrong();
        return enterApp(go, r);
      } catch (err) {
        digits = ''; text.value = '';
        if (!alive) return;
        // Apagado (erros, coação, prazo): volta ao jogo como se nada fosse.
        if (err instanceof VaultWipedError || err instanceof session.PairingExpiredError) { bestBefore = best; return home(); }
        setBusy(false); paintDots();
        if (err instanceof WrongSecretError) {
          dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake');
          say('Código inválido');
          if (await store.noteWrong()) { setBusy(true); setTimeout(() => { if (alive && view === 'code') { busy = false; back(); } }, 1500); }
          return;
        }
        if (err instanceof OfflineError) return say('Sem conexão. Tente de novo.');
        if (err?.name === 'NotAllowedError') return say('Cancelado.');
        say(err?.status === 401 ? 'Este código expirou.' : 'Não deu para verificar. Tente de novo.');
      }
    }

    const entry = pin
      ? h('div', { class: 'sn-keypad' }, ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].map((k) => {
        const b = h('button', { type: 'button', class: k === 'ok' ? 'ok' : k === 'del' ? 'del' : '', 'aria-label': k === 'ok' ? 'Confirmar' : k === 'del' ? 'Apagar' : k, text: k === 'ok' ? 'OK' : k === 'del' ? 'Apagar' : k, onclick: () => press(k) });
        keys.push(b);
        return b;
      }))
      : h('form', { class: 'sn-form', onsubmit: (e) => { e.preventDefault(); const v = text.value; submit(v); } }, text, (() => { const b = h('button', { class: 'sn-primary', text: 'OK' }); keys.push(b); return b; })());
    if (pin) paintDots();
    show(h('div', { class: 'sn-code' },
      h('div', { class: 'sn-code-info' },
        h('div', { class: 'sn-codebar' }, h('button', { type: 'button', class: 'sn-icon light', 'aria-label': 'Voltar', onclick: back }, I.back()), h('span', { text: 'Contribuidores' })),
        h('div', { class: 'sn-skins', 'aria-hidden': 'true' }, ['blue', 'red', 'purple'].map((c) => h('span', { class: c }, h('i')))),
        h('h1', { text: 'Código de contribuidor' }),
        h('p', { text: 'Apoiou a Little Fern Games no Patreon ou em outra plataforma? Digite o código que você recebeu.' }),
        h('p', { class: 'small', text: 'Libera as cores especiais da cobra.' }),
        pin ? dots : null, msg),
      entry), 'code');
    root.setAttribute('data-back', '');
    codeKeys = (e) => {
      if (e.target === text && e.key !== 'Escape') return;
      if (/^\d$/.test(e.key) && pin) press(e.key);
      else if (e.key === 'Backspace' && pin) press('del');
      else if (e.key === 'Enter' && pin) press('ok');
      else if (e.key === 'Escape') back();
      else return;
      e.preventDefault();
    };
    if (!pin) text.focus();
  }
  let codeKeys = null;

  // ---------- teclado, sair do app ----------
  listen(window, 'keydown', (e) => {
    if (view === 'code') return codeKeys?.(e);
    if (e.key === 'Escape' && sheet) { e.preventDefault(); return view === 'play' ? resume() : closeSheet(); }
    if (view === 'play') {
      const d = DIRS[e.key] ?? DIRS[e.key?.toLowerCase?.()];
      if (d) { e.preventDefault(); wakeAudio(); return turnTo(d); }
      if (e.key === ' ' || e.key === 'Escape' || e.key === 'p' || e.key === 'P') { e.preventDefault(); return sheet ? resume() : pause(); }
    }
    if ((view === 'home' || view === 'over') && e.key === 'Enter' && !sheet && !e.target.closest?.('button')) { e.preventDefault(); play(true); }
  });
  listen(document, 'visibilitychange', () => { if (document.hidden && view === 'play' && game.state === 'running') pause(); });

  // Trancar dispara duas idas ao jogo quase juntas (o aviso de "trancado"
  // e o botão): só a mais nova aparece; a outra se desliga sozinha.
  if (latest !== mine) { alive = false; for (const off of offs) off(); return () => {}; }
  if (CONFIG.testHooks) globalThis.__mpSnake = { game, stats, paint: () => paintBoard(performance.now()) };
  const theme = document.querySelector('meta[name="theme-color"]');
  const themeBefore = theme?.getAttribute('content');
  theme?.setAttribute('content', '#4A752C');
  home();
  mount(root);
  return () => {
    alive = false;
    stopLoop(); clearTimeout(dieTimer);
    ro?.disconnect();
    for (const off of offs) off();
    keepBest();
    try { audio?.suspend(); } catch {}
    if (themeBefore) theme?.setAttribute('content', themeBefore);
  };
}
