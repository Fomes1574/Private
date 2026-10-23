// Sobe a API com wrangler dev (workerd + D1 + DOs locais) num diretório
// temporário novo a cada execução, e oferece um cliente de teste.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webcrypto as wc, randomBytes } from 'node:crypto';

const root = new URL('..', import.meta.url).pathname;
const bin = join(root, 'node_modules/.bin/wrangler');
export const SETUP = randomBytes(18).toString('hex');

export async function startApi(port = 8795) {
  const persist = mkdtempSync(join(tmpdir(), 'mp-api-'));
  execFileSync(bin, ['d1', 'migrations', 'apply', 'mp-db', '--local', '--persist-to', persist], { cwd: root, stdio: 'ignore', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' } });
  const proc = spawn(bin, ['dev', '--local', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', persist, '--test-scheduled',
    '--var', `SETUP_CODE:${SETUP}`, '--var', 'APP_ORIGIN:http://app.local'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${base}/v1/time`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return { base, persist, log: () => log, stop: () => { try { process.kill(-proc.pid, 'SIGTERM'); } catch {} } };
}

export function d1(persist, sql) {
  return execFileSync(bin, ['d1', 'execute', 'mp-db', '--local', '--persist-to', persist, '--json', '--command', sql], { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } }).toString();
}

const b64 = (b) => Buffer.from(b).toString('base64');
const key32 = () => b64(randomBytes(32));

// Aparelho de teste: chave de autenticação P-256 não extraível e chaves Olm falsas.
export async function newDevice() {
  const kp = await wc.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const authPub = b64(await wc.subtle.exportKey('raw', kp.publicKey));
  const otks = Object.fromEntries(Array.from({ length: 3 }, (_, i) => [`AAAAA${i}`, key32()]));
  return { kp, public: { authPub, curve: key32(), ed: key32(), otks, fallback: { id: 'AAAAQ', key: key32() } } };
}

export class Client {
  constructor(base) { this.base = base; this.token = null; }
  async req(method, path, body, { raw = false, headers = {} } = {}) {
    const h = { ...headers };
    if (this.token) h.authorization = `Bearer ${this.token}`;
    let payload;
    if (body instanceof Uint8Array) payload = body;
    else if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
    const r = await fetch(this.base + path, { method, headers: h, body: payload });
    if (raw) return r;
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data, time: Number(r.headers.get('x-mp-time')) };
  }
  post(p, b, o) { return this.req('POST', p, b, o); }
  get(p, o) { return this.req('GET', p, undefined, o); }

  async login(device, deviceId) {
    this.device = device; this.deviceId = deviceId;
    const { data: { nonce } } = await this.post('/v1/auth/challenge', { deviceId });
    const sig = await wc.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, device.kp.privateKey, new TextEncoder().encode(`mp-auth-v1:${nonce}:${deviceId}`));
    const r = await this.post('/v1/auth/session', { deviceId, nonce, signature: b64(sig) });
    if (r.status !== 200) throw new Error(`login falhou: ${JSON.stringify(r)}`);
    this.token = r.data.token; this.userId = r.data.userId;
    return r;
  }
}

export const fakeCt = (n = 300) => b64(randomBytes(n));
export const msgId = () => randomBytes(9).toString('base64url');
