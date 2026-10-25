// Cliente HTTP da API. Cada resposta atualiza o relógio confiável com o
// horário do servidor (x-mp-time) e o tempo de ida e volta.
export class ApiError extends Error {
  constructor(status, code, retryAfterMs = 0) { super(`${status} ${code}`); this.status = status; this.code = code; this.retryAfterMs = retryAfterMs; }
}

export class Api {
  // `fetch` precisa ser chamado com this = janela no navegador.
  constructor(base, clock, { fetchImpl = (...a) => globalThis.fetch(...a) } = {}) {
    this.base = base.replace(/\/$/, '');
    this.clock = clock;
    this.fetch = fetchImpl;
    this.token = null;
  }

  async call(method, path, body, { binary = false, rawResponse = false, signal } = {}) {
    const headers = {};
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    let payload;
    if (body instanceof Uint8Array) payload = body;
    else if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    const t0 = performance.now();
    const res = await this.fetch(this.base + path, { method, headers, body: payload, signal });
    const rtt = performance.now() - t0;
    const serverTime = Number(res.headers.get('x-mp-time'));
    if (serverTime > 0) this.clock?.update(serverTime, rtt);
    if (!res.ok) {
      let code = 'error';
      try { code = (await res.json()).error ?? code; } catch {}
      const wait = res.headers.get('retry-after');
      const retryAfterMs = wait === null ? 0 : /^\d+$/.test(wait) ? Number(wait) * 1000 : Math.max(0, Date.parse(wait) - Date.now());
      throw new ApiError(res.status, code, Number.isFinite(retryAfterMs) ? retryAfterMs : 0);
    }
    if (rawResponse) return res;
    return binary ? new Uint8Array(await res.arrayBuffer()) : res.json();
  }

  get(path, opts) { return this.call('GET', path, undefined, opts); }
  post(path, body, opts) { return this.call('POST', path, body, opts); }
}
