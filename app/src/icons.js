// Ícones de traço desenhados no próprio app (sem biblioteca, sem emoji).
// Seguem a cor do texto (currentColor) e não são lidos por leitor de tela:
// o botão que os contém leva o nome.
const PATHS = {
  camera: ['M4 8h3l2-3h6l2 3h3v11H4z', 'circle:12,13,3.5'],
  gallery: ['rect:3,4,18,16,3', 'circle:9,10,2', 'M21 16l-5-5-9 9'],
  document: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5M9 13h6M9 17h4'],
  pen: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
  eraser: ['M20 20H8l-5-5a2 2 0 0 1 0-2.8L12.2 3a2 2 0 0 1 2.8 0l5 5a2 2 0 0 1 0 2.8L11 20', 'M6 10l8 8'],
  undo: ['M9 14L4 9l5-5', 'M4 9h10a6 6 0 0 1 0 12h-3'],
};
const NS = 'http://www.w3.org/2000/svg';

export function icon(name, size = 24) {
  const svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'ico' })) svg.setAttribute(k, String(v));
  for (const d of PATHS[name]) {
    let el;
    if (d.startsWith('circle:')) {
      const [cx, cy, r] = d.slice(7).split(',');
      el = document.createElementNS(NS, 'circle'); el.setAttribute('cx', cx); el.setAttribute('cy', cy); el.setAttribute('r', r);
    } else if (d.startsWith('rect:')) {
      const [x, y, w, hh, rx] = d.slice(5).split(',');
      el = document.createElementNS(NS, 'rect'); el.setAttribute('x', x); el.setAttribute('y', y); el.setAttribute('width', w); el.setAttribute('height', hh); el.setAttribute('rx', rx);
    } else { el = document.createElementNS(NS, 'path'); el.setAttribute('d', d); }
    svg.append(el);
  }
  return svg;
}
