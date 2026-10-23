// Desbloqueio: Face ID + PIN (ou frase-senha). Nada aparece antes disso.
import { h, mount, toast } from '../ui.js';
import * as session from '../session.js';
import { WrongSecretError, VaultWipedError, OfflineError } from '../vault/vault.js';

export async function unlockScreen(go, { again = false } = {}) {
  // Já aberta: não redesenha (apagaria o que a pessoa está digitando).
  if (!again && document.querySelector('#secret')) return;
  const rec = await session.vaultStore.load();
  if (!rec?.wrapped || !rec.vaultId) { await session.wipeEverything().catch(() => {}); return go('welcome'); }
  const pk = rec.mode === 'passkey';
  const input = h('input', { id: 'secret', type: 'password', inputmode: pk ? 'numeric' : 'text', autocomplete: 'current-password' });
  const btn = h('button', { class: 'block', text: 'Desbloquear' });
  const left = h('p', { class: 'muted', text: 'Quem conta os erros é o servidor: na 5ª tentativa errada seguida, os dados deste aparelho viram ilegíveis para sempre.' });
  mount(h('main', { class: 'center' },
    h('div', { class: 'logo', 'aria-hidden': 'true' }),
    h('form', { onsubmit: async (e) => {
      e.preventDefault();
      // Formato errado não gasta tentativa no servidor.
      const problem = pk ? (/^\d{6,12}$/.test(input.value) ? null : 'O PIN tem de 6 a 12 números.') : (input.value.trim() ? null : 'Digite a frase-senha.');
      if (problem) return toast(problem);
      btn.disabled = true;
      const secret = input.value;
      input.value = '';
      try {
        await session.unlock(secret);
        go('chats');
      } catch (err) {
        btn.disabled = false;
        // Destruído (erros, coação, emergência ou prazo): já foi apagado em
        // silêncio; aparece só o app novo, sem aviso.
        if (err instanceof VaultWipedError) return go('welcome');
        if (err instanceof WrongSecretError) { toast(err.left ? `PIN errado. Restam ${err.left} tentativa${err.left > 1 ? 's' : ''}.` : 'PIN errado.'); return unlockScreen(go, { again: true }); }
        if (err instanceof OfflineError) { toast('Sem internet: o app só abre com conexão (protege contra cópia do aparelho).'); return; }
        toast(err.name === 'NotAllowedError' ? 'Face ID cancelado.' : err.status === 401 ? 'Este aparelho foi desconectado (troca de celular ou bloqueio).' : `Não deu: ${err.message}`);
      }
    } }, h('label', { for: 'secret', text: pk ? 'PIN' : 'Frase-senha' }), input, btn), left));
}
