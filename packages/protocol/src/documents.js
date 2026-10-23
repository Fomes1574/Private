// Documentos (§16, V6-019, V6-020): 20 MB por arquivo, 3 ativos por pessoa no
// app inteiro. O quarto envio CONCLUÍDO revoga o ativo mais antigo da pessoa,
// em qualquer conversa, para todos. Falha no quarto não mexe nos três.
export const MAX_DOC_BYTES = 20 * 1024 * 1024;
export const MAX_ACTIVE_DOCS = 3;

// docs: [{ docId, owner, publishedAt, expiresAt, state }] com state em
// 'active' | 'expired' | 'evicted_on_fourth' | 'deleted_for_all'.
export function activeOf(docs, owner, nowMs) {
  return docs
    .filter((d) => d.owner === owner && d.state === 'active' && d.expiresAt > nowMs)
    .sort((a, b) => a.publishedAt - b.publishedAt || (a.docId < b.docId ? -1 : 1));
}

// Publicação atômica: devolve a lista nova e quem foi revogado. Chamada só
// depois do upload cifrado confirmado (uploaded_not_published → active).
export function publish(docs, doc, nowMs) {
  if (!(doc.size > 0 && doc.size <= MAX_DOC_BYTES)) throw new RangeError('documento acima de 20 MB');
  if (docs.some((d) => d.docId === doc.docId)) return { docs, evicted: [] }; // idempotente
  // Vencidos liberam vaga (§16): marca antes de contar.
  let next = docs.map((d) => (d.state === 'active' && d.expiresAt <= nowMs ? { ...d, state: 'expired' } : d));
  const act = activeOf(next, doc.owner, nowMs);
  const evicted = act.length >= MAX_ACTIVE_DOCS ? act.slice(0, act.length - MAX_ACTIVE_DOCS + 1).map((d) => d.docId) : [];
  next = next.map((d) => (evicted.includes(d.docId) ? { ...d, state: 'evicted_on_fourth' } : d));
  next.push({ ...doc, state: 'active', publishedAt: doc.publishedAt ?? nowMs });
  return { docs: next, evicted };
}

// "Apagar para mim" não libera vaga: o documento continua ativo para os outros.
export function deleteForAll(docs, docId, actor) {
  const d = docs.find((x) => x.docId === docId);
  if (!d) return docs;
  if (d.owner !== actor) throw new Error('só o autor apaga para todos');
  return docs.map((x) => (x.docId === docId && x.state === 'active' ? { ...x, state: 'deleted_for_all' } : x));
}
