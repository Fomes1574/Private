// Utilidades comuns dos testes de navegador. Sobe o servidor local das provas.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Use localhost, não 127.0.0.1: passkey (WebAuthn) não aceita IP como domínio.
export const BASE = process.env.E2E_BASE || 'http://localhost:8091';

export async function startServer() {
  if (process.env.E2E_BASE) return () => {};
  const proc = spawn(process.execPath, [new URL('../scripts/serve.mjs', import.meta.url).pathname], {
    env: { ...process.env, PORT: '8091' }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve) => proc.stdout.once('data', resolve));
  return () => proc.kill();
}

export async function browser({ args = [] } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'e2e-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    headless: true,
    // Microfone e câmera simulados para os testes de áudio.
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', ...args],
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  return ctx;
}

export function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

// Autenticador de plataforma virtual com PRF (simula Face ID que sempre aprova).
export async function virtualAuthenticator(page, { prf = true } = {}) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal',
      hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
      hasPrf: prf, automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId };
}
