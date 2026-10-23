// Horário (§10, V6-011): exibição sempre em Brasília; instantes em UTC.
// O relógio do aparelho nunca decide prazo: usa-se o tempo do servidor
// ancorado num relógio monotônico local.
export const TIME_ZONE = 'America/Sao_Paulo';

const fmtTime = new Intl.DateTimeFormat('pt-BR', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' });
const fmtFull = new Intl.DateTimeFormat('pt-BR', { timeZone: TIME_ZONE, dateStyle: 'short', timeStyle: 'short' });

export const formatTime = (ms) => fmtTime.format(ms);
export const formatDateTime = (ms) => fmtFull.format(ms);

// Tempo confiável: amostra do servidor + quanto passou no relógio monotônico.
// `performance.now()` não prova tempo em suspensão longa (§13), então a
// amostra vence depois de `maxAgeMs` e o cliente precisa falar com o servidor.
export class TrustedClock {
  constructor({ monotonic = () => performance.now(), maxAgeMs = 5 * 60_000 } = {}) {
    this.monotonic = monotonic;
    this.maxAgeMs = maxAgeMs;
    this.sample = null;
  }

  // serverMs: tempo do servidor na resposta; rttMs: ida e volta medida.
  update(serverMs, rttMs = 0) {
    if (!Number.isFinite(serverMs) || !(rttMs >= 0)) throw new TypeError('amostra inválida');
    this.sample = { serverMs: serverMs + rttMs / 2, at: this.monotonic() };
  }

  // Devolve o "agora" do servidor ou null se não houver amostra recente.
  now() {
    if (!this.sample) return null;
    const elapsed = this.monotonic() - this.sample.at;
    if (elapsed < 0 || elapsed > this.maxAgeMs) return null;
    return Math.round(this.sample.serverMs + elapsed);
  }

  invalidate() { this.sample = null; }
}
