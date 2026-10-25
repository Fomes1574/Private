// Datas como no WhatsApp, no horário de Brasília: "Hoje", "Ontem", dia da
// semana na última semana e a data completa antes disso.
import { TIME_ZONE, formatTime } from './packages/protocol/src/time.js';

const fmtKey = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtWeek = new Intl.DateTimeFormat('pt-BR', { timeZone: TIME_ZONE, weekday: 'long' });
const fmtDate = new Intl.DateTimeFormat('pt-BR', { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric' });
export const dayKey = (ms) => fmtKey.format(ms);
const daysBetween = (a, b) => Math.round((Date.parse(dayKey(b)) - Date.parse(dayKey(a))) / 86_400_000);
export function dayLabel(ms, now = Date.now()) {
  const d = daysBetween(ms, now);
  if (d === 0) return 'Hoje';
  if (d === 1) return 'Ontem';
  if (d > 1 && d < 7) { const w = fmtWeek.format(ms); return w[0].toUpperCase() + w.slice(1); }
  return fmtDate.format(ms);
}
// Na lista: hora se for hoje, "Ontem", depois a data.
export function listTime(ms, now = Date.now()) {
  const d = daysBetween(ms, now);
  return d === 0 ? formatTime(ms) : d === 1 ? 'Ontem' : fmtDate.format(ms);
}
