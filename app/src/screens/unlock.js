// Desbloqueio: Face ID + PIN (ou frase-senha). Nada aparece antes disso.
import { h, mount, toast } from '../ui.js';
import * as session from '../session.js';
import { WrongSecretError, VaultWipedError, OfflineError } from '../vault/vault.js';
import { takeAttachment } from '../attachment-picker.js';

export async function unlockScreen(go, { again = false } = {}) {
  // Já aberta: não redesenha (apagaria o que a pessoa está digitando).
  if (!again && document.querySelector('#secret')) return;
  const rec = await session.vaultStore.load();
  // Sem cofre (ou destruído): começa do zero. Cofre antigo (v1, sem a parte
  // do servidor) NÃO é apagado: abre e migra (vault.js, openLegacy).
  if (!rec?.wrapped) { if (rec) await session.wipeEverything().catch(() => {}); return go('welcome'); }
  const pk = rec.mode === 'passkey';
  const input = h('input', { id: 'secret', type: 'password', inputmode: pk ? 'numeric' : 'text', autocomplete: 'current-password' });
  const btn = h('button', { class: 'block', text: 'Desbloquear' });
  session.prewarm();
  const left = h('p', { class: 'muted', text: 'Quem conta os erros é o servidor: na 5ª tentativa errada seguida, os dados deste aparelho viram ilegíveis para sempre.' });
  mount(h('main', { class: 'center' },
    h('div', { class: 'logo', 'aria-hidden': 'true' }),
    h('form', { onsubmit: async (e) => {
      e.preventDefault();
      // Formato errado não gasta tentativa no servidor.
      const problem = pk ? (/^\d{6,12}$/.test(input.value) ? null : 'O PIN tem de 6 a 12 números.') : (input.value.trim() ? null : 'Digite a frase-senha.');
      if (problem) return toast(problem);
      btn.disabled = true;
      btn.textContent = 'Abrindo…';
      const secret = input.value;
      input.value = '';
      try {
        const r = await session.unlock(secret);
        // Troca de celular que ficou no meio: volta para a espera.
        if (r?.pairing) return go('pairWait', r.pairing);
        // Escolheu foto/arquivo e o app trancou no caminho: volta direto
        // para onde estava, com a seleção (sem passar pela lista).
        const attachment = takeAttachment();
        if (attachment) return go(attachment.pick.target === 'settings' ? 'settings' : attachment.pick.target === 'stories' ? 'stories' : attachment.roomId ? 'chat' : 'chats', { roomId: attachment.roomId, attachment });
        go('chats');
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Desbloquear';
        // Destruído (erros, coação, emergência ou prazo): já foi apagado em
        // silêncio; aparece só o app novo, sem aviso.
        if (err instanceof VaultWipedError) return go('welcome');
        if (err instanceof session.PairingExpiredError) { toast(err.message); return go('welcome'); }
        if (err instanceof WrongSecretError) { toast(err.left ? `PIN errado. Restam ${err.left} tentativa${err.left > 1 ? 's' : ''}.` : 'PIN errado.'); return unlockScreen(go, { again: true }); }
        if (err instanceof OfflineError) { toast('Sem internet: o app só abre com conexão (protege contra cópia do aparelho).'); return; }
        toast(err.name === 'NotAllowedError' ? 'Face ID cancelado.' : err.status === 401 ? 'Este aparelho foi desconectado (troca de celular ou bloqueio).' : `Não deu: ${err.message}`);
      }
    } }, h('label', { for: 'secret', text: pk ? 'PIN' : 'Frase-senha' }), input, btn), left));
}
