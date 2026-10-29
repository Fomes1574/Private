// Motor do Hungry Snake: só regras, sem tela nem relógio. A tela chama
// step() no ritmo de stepMs() e desenha entre um passo e outro.
export const N = 15;
export const SPEEDS = { slow: 170, normal: 135, fast: 100 };
const FLOOR = { slow: 110, normal: 85, fast: 65 };

export function createGame({ mode = 'classic', speed = 'normal', random = Math.random } = {}) {
  const g = { mode, speed, random, score: 0, state: 'ready', dir: [1, 0], queue: [], snake: [], prev: [], food: [0, 0], ate: false, died: null };
  reset(g);
  return g;
}

export function reset(g) {
  g.snake = [[5, 7], [4, 7], [3, 7]];
  g.prev = g.snake.map((p) => p.slice());
  g.dir = [1, 0]; g.queue = []; g.score = 0; g.ate = false; g.died = null; g.state = 'ready';
  g.food = [10, 7];
}

// Fica mais rápida a cada maçã, até um limite por velocidade.
export const stepMs = (g) => Math.max(FLOOR[g.speed] ?? 85, (SPEEDS[g.speed] ?? 135) - g.score * 2);

// Até 3 viradas na fila; meia-volta e repetição são ignoradas.
export function turn(g, d) {
  const last = g.queue.length ? g.queue[g.queue.length - 1] : g.dir;
  if ((d[0] === last[0] && d[1] === last[1]) || (d[0] === -last[0] && d[1] === -last[1])) return false;
  if (g.queue.length < 3) g.queue.push(d);
  return true;
}

export function placeFood(g) {
  const free = [];
  const taken = new Set(g.snake.map((p) => p[0] * N + p[1]));
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) if (!taken.has(x * N + y)) free.push([x, y]);
  return free.length ? free[Math.floor(g.random() * free.length)] : null;
}

// Um passo. Devolve 'eat', 'die' ou null.
export function step(g) {
  if (g.state !== 'running') return null;
  if (g.queue.length) g.dir = g.queue.shift();
  const head = g.snake[0];
  let nx = head[0] + g.dir[0], ny = head[1] + g.dir[1];
  const out = nx < 0 || ny < 0 || nx >= N || ny >= N;
  if (out && g.mode === 'wrap') { nx = (nx + N) % N; ny = (ny + N) % N; }
  const eat = nx === g.food[0] && ny === g.food[1];
  // A cauda sai do lugar no mesmo passo: encostar nela não mata.
  const body = eat ? g.snake : g.snake.slice(0, -1);
  if ((out && g.mode !== 'wrap') || body.some((p) => p[0] === nx && p[1] === ny)) {
    g.state = 'over'; g.died = out ? 'wall' : 'self';
    return 'die';
  }
  g.prev = g.snake.map((p) => p.slice());
  g.snake = [[nx, ny], ...body];
  g.ate = eat;
  if (!eat) return null;
  g.score += 1;
  const f = placeFood(g);
  if (!f) { g.state = 'over'; g.died = 'full'; return 'die'; }
  g.food = f;
  return 'eat';
}

// Pontos do corpo para desenhar (em casas), com a cabeça e a cauda no meio
// do caminho (t de 0 a 1). Sem paredes, quem passa pela borda vira dois
// pedaços: cada um sai um pouco para fora e a tela corta.
export function bodyPieces(g, t) {
  const wrap = g.mode === 'wrap';
  const toward = (a, b) => {
    let dx = b[0] - a[0], dy = b[1] - a[1];
    if (wrap) { if (Math.abs(dx) > 1) dx -= Math.sign(dx) * N; if (Math.abs(dy) > 1) dy -= Math.sign(dy) * N; }
    return [dx, dy];
  };
  const along = (a, b) => { const d = toward(a, b); return [a[0] + d[0] * t, a[1] + d[1] * t]; };
  const pts = [along(g.prev[0], g.snake[0]), ...g.snake.slice(1)];
  if (!g.ate && g.prev.length === g.snake.length) pts.push(along(g.prev[g.prev.length - 1], g.snake[g.snake.length - 1]));
  if (!wrap) return [pts];
  const norm = (v) => (((v + 0.5) % N) + N) % N - 0.5;
  const P = pts.map((p) => [norm(p[0]), norm(p[1])]);
  const pieces = [];
  let cur = [P[0]];
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1], b = P[i];
    if (Math.abs(b[0] - a[0]) > N / 2 || Math.abs(b[1] - a[1]) > N / 2) {
      const d = toward(a, b);
      cur.push([a[0] + d[0], a[1] + d[1]]);
      pieces.push(cur);
      cur = [[b[0] - d[0], b[1] - d[1]], b];
    } else cur.push(b);
  }
  pieces.push(cur);
  return pieces;
}
