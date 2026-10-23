// Escolha de PIN e criação da passkey (V7-019, ADR 0005).
import { h, toast } from '../ui.js';
import * as session from '../session.js';
import { checkPin, checkPassphrase } from '../vault/vault.js';

export function lockSetupForm(onDone) {
  const hasPasskey = 'PublicKeyCredential' in globalThis || !!globalThis.Capacitor?.isNativePlatform?.();
  const mode = h('select', { id: 'mode' },
    hasPasskey ? h('option', { value: 'passkey', text: 'Face ID ou digital + PIN' }) : null,
    h('option', { value: 'passphrase', text: 'Só frase-senha (sem Face ID)' }));
  const label = h('label', { for: 's1', text: 'PIN (6 a 12 números)' });
  const s1 = h('input', { id: 's1', type: 'password', inputmode: 'numeric', autocomplete: 'new-password' });
  const s2 = h('input', { id: 's2', type: 'password', inputmode: 'numeric', autocomplete: 'new-password', 'aria-label': 'Repita' });
  const btn = h('button', { class: 'block', text: 'Continuar' });
  mode.onchange = () => {
    const pk = mode.value === 'passkey';
    label.textContent = pk ? 'PIN (6 a 12 números)' : 'Frase-senha (4 palavras ou 16 caracteres)';
    s1.inputMode = s2.inputMode = pk ? 'numeric' : 'text';
  };
  if (!hasPasskey) mode.onchange();
  return h('form', { onsubmit: async (e) => {
    e.preventDefault();
    const pk = mode.value === 'passkey';
    const problem = pk ? checkPin(s1.value) : checkPassphrase(s1.value);
    if (problem) return toast(problem);
    if (s1.value !== s2.value) return toast('Os dois campos não são iguais.');
    btn.disabled = true;
    try {
      const lock = await session.createLock({ mode: mode.value, secret: s1.value });
      s1.value = s2.value = '';
      await onDone(lock);
    } catch (err) {
      btn.disabled = false;
      toast(err.name === 'NotAllowedError' ? 'Face ID cancelado.' : /PRF/.test(err.message) ? 'Este aparelho não liberou a chave pelo Face ID. Use a frase-senha.' : `Não deu: ${err.message}`);
    }
  } }, h('label', { for: 'mode', text: 'Como abrir o app' }), mode, label, s1, h('label', { for: 's2', text: 'Repita' }), s2, btn,
  h('p', { class: 'note', text: 'Se esquecer o PIN ou perder o aparelho, o histórico se perde. A recuperação da conta precisa da administradora e do seu guardião, com 24 horas de espera.' }));
}
