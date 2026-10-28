// Avatar: inicial do apelido; se houver foto (cifrada), troca pela imagem
// decifrada em memória. Sem foto, nada é pedido ao servidor.
import { h } from './ui.js';
import * as session from './session.js';

// Cor da inicial pelo apelido: a mesma pessoa tem sempre a mesma cor.
const tone = (name) => { let n = 0; for (const c of name || '?') n = (n * 31 + c.codePointAt(0)) >>> 0; return n % 6; };

export function avatar(name, ref, { big = false } = {}) {
  const el = h('span', { class: `${big ? 'avatar big' : 'avatar'} av-${tone(name)}`, 'aria-hidden': 'true', text: (name || '?').slice(0, 1).toUpperCase() });
  if (ref) {
    session.visualURL(ref).then((url) => {
      if (!url) return;
      el.replaceChildren(h('img', { src: url, alt: '', draggable: 'false' }));
      el.classList.add('has-photo');
    });
  }
  return el;
}
