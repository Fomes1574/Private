// Avatar: inicial do apelido; se houver foto (cifrada), troca pela imagem
// decifrada em memória. Sem foto, nada é pedido ao servidor.
import { h } from './ui.js';
import * as session from './session.js';

export function avatar(name, ref, { big = false } = {}) {
  const el = h('span', { class: big ? 'avatar big' : 'avatar', 'aria-hidden': 'true', text: (name || '?').slice(0, 1).toUpperCase() });
  if (ref) {
    session.visualURL(ref).then((url) => {
      if (!url) return;
      el.replaceChildren(h('img', { src: url, alt: '', draggable: 'false' }));
      el.classList.add('has-photo');
    });
  }
  return el;
}
