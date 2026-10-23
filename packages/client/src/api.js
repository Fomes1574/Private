// Cliente HTTP da API. Cada resposta atualiza o relógio confiável com o
// horário do servidor (x-mp-time) e o tempo de ida e volta.
export class ApiError extends Error {
  constructor(status, code) { super(`${status} ${code}`); this.status = status; this.code = code; }
}

export class Api {
  constructor(base, clock, { fetchImpl = globalThis.fetch } = {}) {
    this.base = base.replace(/\/$/, '');
    this.clock = clock;
    this.fetch = fetchImpl;
    this.token = null;
  }

  async call(method, path, body, { binary = false, rawResponse = false } = {}) {
    const headers = {};
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    let payload;
    if (body instanceof Uint8Array) payload = body;
    else if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    const t0 = performance.now();
    const res = await this.fetch(this.base + path, { method, headers, body: payload });
    const rtt = performance.now() - t0;
    const serverTime = Number(res.headers.get('x-mp-time'));
    if (serverTime > 0) this.clock?.update(serverTime, rtt);
    if (!res.ok) {
      let code = 'error';
      try { code = (await res.json()).error ?? code; } catch {}
      throw new ApiError(res.status, code);
    }
    if (rawResponse) return res;
    return binary ? new Uint8Array(await res.arrayBuffer()) : res.json();
  }

  get(path) { return this.call('GET', path); }
  post(path, body, opts) { return this.call('POST', path, body, opts); }
}
