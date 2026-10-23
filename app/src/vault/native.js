// No APK Android (Capacitor), o segredo que faz o papel do PRF vem do
// Android Keystore depois da biometria (plugin BiometricSecret, ADR 0005).
import { unb64 } from './vault.js';

export const NATIVE_ID = 'android-keystore';
const plugin = () => globalThis.Capacitor?.isNativePlatform?.() ? globalThis.Capacitor.Plugins?.BiometricSecret : null;

export const isNative = () => !!plugin();

export async function nativeAvailable() {
  const p = plugin();
  if (!p) return false;
  try { return (await p.available()).available === true; } catch { return false; }
}

export async function nativeSecret() {
  const { secret } = await plugin().secret();
  return unb64(secret);
}

export async function nativeDestroy() {
  try { await plugin()?.destroy(); } catch {}
}
