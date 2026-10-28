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
  back: ['M15 18l-6-6 6-6'],
  more: ['circle:12,5,1', 'circle:12,12,1', 'circle:12,19,1'],
  plus: ['M12 5v14M5 12h14'],
  smile: ['circle:12,12,9', 'M8.5 14.5a4.5 4.5 0 0 0 7 0', 'M9 9.5h.01M15 9.5h.01'],
  mic: ['rect:9,3,6,11,3', 'M5 11a7 7 0 0 0 14 0M12 18v3'],
  send: ['M5 12h14M13 6l6 6-6 6'],
  close: ['M6 6l12 12M18 6L6 18'],
  settings: ['circle:12,12,3', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
  note: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5', 'M9 14l2 2 4-4'],
  stories: ['circle:12,12,9', 'circle:12,12,4'],
  pin: ['M12 17v5', 'M9 3h6l-1 6 3 3v2H7v-2l3-3z'],
  mute: ['M13.7 21a2 2 0 0 1-3.4 0', 'M18 8a6 6 0 0 0-9.3-5', 'M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14', 'M3 3l18 18'],
  star: ['M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z'],
  clock: ['circle:12,12,9', 'M12 7v5l3 2'],
  group: ['M16 19v-1a4 4 0 0 0-8 0v1', 'circle:12,8,3', 'M20 19v-1a3 3 0 0 0-2-2.8M17 4.2a3 3 0 0 1 0 5.6'],
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
