// WebAuthn com extensão PRF (ADR 0005). Nada aqui fala com o servidor.
// rp.name genérico: nome do produto ainda não decidido (P-19).
import { random, b64, unb64 } from './vault.js';

export async function capabilities() {
  const out = { webauthn: 'PublicKeyCredential' in globalThis };
  if (!out.webauthn) return out;
  try { out.platformAuthenticator = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch (e) { out.platformAuthenticator = String(e); }
  try {
    const caps = await PublicKeyCredential.getClientCapabilities?.();
    if (caps) out.prfCapability = caps['extension:prf'] ?? null;
  } catch (e) { out.prfCapability = String(e); }
  return out;
}

// Cria a passkey. Alguns navegadores já devolvem o PRF aqui; outros só no get().
export async function register(prfSalt) {
  const cred = await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Mensageiro' },
      user: { id: random(16), name: 'membro', displayName: 'Membro' },
      challenge: random(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      extensions: { prf: { eval: { first: prfSalt } } },
    },
  });
  const ext = cred.getClientExtensionResults().prf || {};
  return {
    credentialId: b64(new Uint8Array(cred.rawId)),
    prfEnabled: ext.enabled === true,
    prf: ext.results?.first ? new Uint8Array(ext.results.first) : null,
  };
}

export async function evaluate(credentialId, prfSalt) {
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge: random(32),
      allowCredentials: [{ type: 'public-key', id: unb64(credentialId) }],
      userVerification: 'required',
      extensions: { prf: { eval: { first: prfSalt } } },
    },
  });
  const first = cred.getClientExtensionResults().prf?.results?.first;
  if (!first) throw new Error('O aparelho não devolveu o PRF.');
  return new Uint8Array(first);
}
