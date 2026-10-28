// D13: ida rápida ao seletor de fotos/arquivos aberto pelo próprio app.
// Voltando em até 2 minutos, o app não pede o PIN de novo (a capa e o
// bloqueio de print continuam). Passou disso, tranca como qualquer saída.
export const PICKER_GRACE_MS = 2 * 60_000;
let until = 0;
export function beginPickerTrip(now = Date.now()) { until = now + PICKER_GRACE_MS; }
export function pickerTripActive(now = Date.now()) { return until > now; }
export function pickerTripLeft(now = Date.now()) { return Math.max(0, until - now); }
export function endPickerTrip() { until = 0; }
