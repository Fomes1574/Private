// Prazos (§10, V6-009, V6-010). Duração absoluta; "dia" = 24 h.
export const HOUR = 3600;
export const DAY = 24 * HOUR;
export const MIN_TTL = 12 * HOUR;
export const MAX_TTL = 15 * DAY;
export const DEFAULT_TTL = 5 * DAY;

// Opções da interface. Todas dentro da faixa; não existe "Nunca".
export const TTL_OPTIONS = [12 * HOUR, 24 * HOUR, 3 * DAY, 5 * DAY, 7 * DAY, 10 * DAY, 15 * DAY];

export function isValidTtl(seconds) {
  return Number.isInteger(seconds) && seconds >= MIN_TTL && seconds <= MAX_TTL;
}

export function assertTtl(seconds) {
  if (!isValidTtl(seconds)) throw new RangeError(`prazo fora de 12 h–15 dias: ${seconds}`);
  return seconds;
}

// O prazo vale a partir do aceite carimbado pelo SERVIDOR, nunca do relógio
// do remetente (§10).
export function expiresAt(acceptedAtMs, ttlSeconds) {
  if (!Number.isSafeInteger(acceptedAtMs)) throw new TypeError('acceptedAt inválido');
  return acceptedAtMs + assertTtl(ttlSeconds) * 1000;
}

export function isExpired(expiresAtMs, trustedNowMs) {
  if (!Number.isFinite(trustedNowMs)) return true; // sem tempo confiável: trata como vencido (falha fechada)
  return trustedNowMs >= expiresAtMs;
}

export function describeTtl(seconds) {
  if (seconds % DAY === 0) return seconds === DAY ? '1 dia' : `${seconds / DAY} dias`;
  return `${seconds / HOUR} horas`;
}
