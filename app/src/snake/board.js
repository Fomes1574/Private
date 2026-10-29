// Tabuleiro do Hungry Snake em canvas. Tudo em pixels reais da tela: casa
// com tamanho inteiro e espessuras com a mesma paridade da casa, para a cobra
// ter a mesma grossura em qualquer linha ou coluna, em pé ou deitado.
import { N, bodyPieces } from './engine.js';

const LIGHT = '#AAD751', DARK = '#A2D149';

export function createBoard(canvas) {
  const g = canvas.getContext('2d');
  let W = 0, c = 0, off = 0, bg = null, particles = [];

  function resize(cssSize) {
    const dpr = window.devicePixelRatio || 1;
    const next = Math.max(N, Math.round(cssSize * dpr));
    canvas.style.width = canvas.style.height = `${cssSize}px`;
    if (next === W) return;
    W = next; canvas.width = canvas.height = W;
    c = Math.floor(W / N); off = Math.floor((W - c * N) / 2);
    // Fundo quadriculado desenhado uma vez por tamanho.
    bg = document.createElement('canvas');
    bg.width = bg.height = W;
    const b = bg.getContext('2d');
    b.fillStyle = LIGHT; b.fillRect(0, 0, W, W);
    b.fillStyle = DARK;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if ((x + y) % 2) b.fillRect(off + x * c, off + y * c, c, c);
  }

  const width = (f) => { let v = Math.max(2, Math.round(c * f)); if ((v % 2 === 0) !== (c % 2 === 0)) v += 1; return v; };
  const px = (v) => off + v * c + c / 2;

  function burst(cell) {
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI * 2 * i) / 10, v = 0.06 + Math.random() * 0.07;
      particles.push({ x: cell[0] + 0.5, y: cell[1] + 0.5, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, color: i % 2 ? '#FFD54A' : '#E7471D' });
    }
  }

  function draw(game, t, now) {
    if (!W || !bg) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(bg, 0, 0);
    g.save();
    g.beginPath(); g.rect(off, off, c * N, c * N); g.clip();

    // Maçã: brilho, cabinho e folha.
    if (game.state !== 'over' || game.died !== 'full') {
      const fx = px(game.food[0]), fy = px(game.food[1]);
      const r = c * 0.36 * (1 + 0.05 * Math.sin(now / 220));
      g.fillStyle = 'rgba(0,0,0,.12)'; g.beginPath(); g.ellipse(fx, fy + r * 0.88, r * 0.78, r * 0.26, 0, 0, Math.PI * 2); g.fill();
      const grad = g.createRadialGradient(fx - r * 0.35, fy - r * 0.35, r * 0.1, fx, fy, r);
      grad.addColorStop(0, '#FF7A4D'); grad.addColorStop(1, '#D3380F');
      g.fillStyle = grad; g.beginPath(); g.arc(fx, fy, r, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.ellipse(fx - r * 0.38, fy - r * 0.38, r * 0.22, r * 0.14, -0.7, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#5D4037'; g.lineWidth = Math.max(2, c * 0.08); g.lineCap = 'round';
      g.beginPath(); g.moveTo(fx, fy - r * 0.8); g.quadraticCurveTo(fx + c * 0.04, fy - r * 1.25, fx + r * 0.35, fy - r * 1.4); g.stroke();
      g.fillStyle = '#43A047'; g.beginPath(); g.ellipse(fx + r * 0.62, fy - r * 1.18, r * 0.42, r * 0.2, -0.5, 0, Math.PI * 2); g.fill();
    }

    // Cobra: contorno e corpo, andando entre uma casa e outra.
    const pieces = bodyPieces(game, t).map((piece) => piece.map((p) => [px(p[0]), px(p[1])]));
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const [color, f] of [['#2F5FD0', 0.8], ['#4E7CF6', 0.64]]) {
      g.strokeStyle = color; g.lineWidth = width(f);
      for (const P of pieces) {
        g.beginPath(); g.moveTo(P[0][0], P[0][1]);
        if (P.length === 1) g.lineTo(P[0][0] + 0.01, P[0][1]);
        for (let i = 1; i < P.length; i++) g.lineTo(P[i][0], P[i][1]);
        g.stroke();
      }
    }
    const [hx, hy] = pieces[0][0], d = game.dir, ox = -d[1], oy = d[0];
    const dead = game.state === 'over' && game.died !== 'full';
    for (const side of [-1, 1]) {
      const ex = hx + d[0] * c * 0.12 + ox * c * 0.2 * side, ey = hy + d[1] * c * 0.12 + oy * c * 0.2 * side;
      g.fillStyle = '#FFFFFF'; g.beginPath(); g.arc(ex, ey, c * 0.14, 0, Math.PI * 2); g.fill();
      if (dead) {
        // Olhos de tonto (×).
        const k = c * 0.07;
        g.strokeStyle = '#1B1B1B'; g.lineWidth = Math.max(1.5, c * 0.04);
        g.beginPath(); g.moveTo(ex - k, ey - k); g.lineTo(ex + k, ey + k); g.moveTo(ex + k, ey - k); g.lineTo(ex - k, ey + k); g.stroke();
      } else {
        g.fillStyle = '#1B1B1B'; g.beginPath(); g.arc(ex + d[0] * c * 0.05, ey + d[1] * c * 0.05, c * 0.075, 0, Math.PI * 2); g.fill();
      }
    }

    // Estouro ao comer.
    particles = particles.filter((p) => p.life > 0);
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy; p.vx *= 0.92; p.vy *= 0.92; p.life -= 0.04;
      g.globalAlpha = Math.max(0, p.life); g.fillStyle = p.color;
      g.beginPath(); g.arc(off + p.x * c, off + p.y * c, c * 0.12 * p.life + 1, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    g.restore();
  }

  return { resize, draw, burst, busy: () => particles.length > 0, clear: () => { particles = []; } };
}
