// Apelidos (V7-006): únicos no círculo, comparação sem acento e em minúsculas,
// busca local por prefixo. Nunca são identificador criptográfico.
export function normalize(nick) {
  return nick.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function validNickname(nick) {
  const n = nick.trim();
  if (n.length < 2 || n.length > 24) return 'Use de 2 a 24 caracteres.';
  if (!/^[\p{L}\p{N} ._-]+$/u.test(n)) return 'Use letras, números, espaço, ponto, hífen ou sublinhado.';
  return null;
}

// directory: [{ userId, nickname }] guardado cifrado no aparelho.
export function isAvailable(directory, nick, exceptUserId = null) {
  const n = normalize(nick);
  return !directory.some((d) => d.userId !== exceptUserId && normalize(d.nickname) === n);
}

// Busca só no aparelho; o termo nunca vai para o servidor.
export function searchByPrefix(directory, term, { self = null, limit = 10 } = {}) {
  const t = normalize(term);
  if (!t) return [];
  return directory
    .filter((d) => d.userId !== self && normalize(d.nickname).startsWith(t))
    .sort((a, b) => normalize(a.nickname).localeCompare(normalize(b.nickname)))
    .slice(0, limit);
}

export function renameNotice(oldNick, newNick) {
  return `${oldNick} alterou seu nome para ${newNick}`;
}
