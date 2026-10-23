// Desbloqueio: Face ID + PIN (ou frase-senha). Nada aparece antes disso.
import { h, mount, toast, confirmSheet } from '../ui.js';
import * as session from '../session.js';
import { MAX_FAILURES, WrongSecretError, VaultWipedError } from '../vault/vault.js';

export async function unlockScreen(go) {
  const rec = await session.vaultStore.load();
  if (!rec?.wrapped) return wiped(go);
  const pk = rec.mode === 'passkey';
  const input = h('input', { id: 'secret', type: 'password', inputmode: pk ? 'numeric' : 'text', autocomplete: 'current-password' });
  const btn = h('button', { class: 'block', text: 'Desbloquear' });
  const left = h('p', { class: 'muted', text: rec.failures ? `${rec.failures} de ${MAX_FAILURES} tentativas erradas. Na ${MAX_FAILURES}ª, os dados deste aparelho viram ilegíveis.` : '' });
  mount(h('main', { class: 'center' },
    h('div', { class: 'logo', 'aria-hidden': 'true' }),
    h('form', { onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true;
      const secret = input.value;
      input.value = '';
      try {
        await session.unlock(secret);
        go('chats');
      } catch (err) {
        btn.disabled = false;
        if (err instanceof VaultWipedError) return wiped(go);
        if (err instanceof WrongSecretError) { toast('PIN errado.'); return unlockScreen(go); }
        toast(err.name === 'NotAllowedError' ? 'Face ID cancelado.' : err.status === 401 ? 'Este aparelho foi desconectado (troca de celular ou bloqueio).' : `Não deu: ${err.message}`);
      }
    } }, h('label', { for: 'secret', text: pk ? 'PIN' : 'Frase-senha' }), input, btn), left));
}

function wiped(go) {
  mount(h('main', { class: 'center' },
    h('h1', { text: 'Chave destruída' }),
    h('p', { text: 'Depois de tentativas erradas demais, a chave deste aparelho foi apagada. As conversas guardadas aqui não podem mais ser lidas.' }),
    h('p', { class: 'muted', text: 'Para voltar, peça à administradora a recuperação da conta (com seu guardião e 24 horas de espera).' }),
    h('button', { class: 'block danger', text: 'Apagar tudo deste aparelho', onclick: async () => {
      if (await confirmSheet('Apagar todos os dados do app neste aparelho?', 'Apagar')) { await session.wipeEverything(); go('welcome'); }
    } })));
}
