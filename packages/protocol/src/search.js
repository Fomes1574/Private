// Busca local por trecho (D1), sem acento e sem maiúscula. O termo nunca sai
// do aparelho. Ordem: começa com o termo > começo de palavra (depois de
// espaço, _, ., -) > qualquer posição; empate em ordem alfabética.
import { normalize } from './nickname.js';

export function matchRank(name, term) {
  const n = normalize(name ?? ''), t = normalize(term ?? '');
  if (!t) return -1;
  const i = n.indexOf(t);
  if (i < 0) return -1;
  if (i === 0) return 0;
  // começo de alguma palavra
  for (let j = n.indexOf(t); j >= 0; j = n.indexOf(t, j + 1)) if (/[\s_.\-]/.test(n[j - 1])) return 1;
  return 2;
}

// items: [{ ...qualquer coisa, label }]
export function searchByText(items, term, { limit = 20 } = {}) {
  return items
    .map((it) => ({ it, r: matchRank(it.label, term) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || normalize(a.it.label).localeCompare(normalize(b.it.label)))
    .slice(0, limit)
    .map((x) => x.it);
}
