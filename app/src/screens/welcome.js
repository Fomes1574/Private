// Entrada sem conta (§5): "Tenho um convite" e "Já uso em outro celular".
// Não existe "criar conta". A primeira pessoa (administradora) usa o código
// de instalação, só pelo endereço com #instalar.
import { h, mount, toast } from '../ui.js';
import * as session from '../session.js';
import { lockSetupForm } from './lock-setup.js';

const TAGLINE = 'O único lugar verdadeiramente seguro para o pacto.';

export function welcome(go) {
  const isSetup = location.hash === '#instalar';
  mount(h('main', { class: 'center' },
    h('div', { class: 'brand' }, h('div', { class: 'logo', 'aria-hidden': 'true' }), h('p', { class: 'muted', text: TAGLINE })),
    isSetup
      ? h('button', { class: 'block', text: 'Instalar a primeira pessoa', onclick: () => withLock(go, 'bootstrap') })
      : [
        h('button', { class: 'block', text: 'Tenho um convite', onclick: () => withLock(go, 'invite') }),
        h('button', { class: 'block secondary', text: 'Já uso em outro celular', onclick: () => withLock(go, 'pair') }),
      ],
    installHint()));
}

function installHint() {
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  if (standalone) return null;
  const ios = /iPhone|iPad/.test(navigator.userAgent);
  return h('p', { class: 'note', text: ios
    ? 'Para usar de verdade, instale: Compartilhar → Adicionar à Tela de Início, e abra pelo ícone. O Safari e o app instalado guardam dados separados.'
    : 'Abra pelo app instalado para guardar seus dados com mais segurança.' });
}

// Antes de falar com o servidor, cria o cofre (Face ID + PIN).
function withLock(go, how) {
  mount(h('main', {},
    h('h1', { text: 'Proteja este aparelho' }),
    h('p', { class: 'muted', text: 'Para abrir o app vão ser pedidos o Face ID (ou a digital) e um PIN só seu. Os dois juntos liberam a chave que cifra tudo neste aparelho.' }),
    lockSetupForm(async (lock) => {
      if (how === 'pair') return pairScreen(go, lock);
      tokenScreen(go, how, lock);
    })));
}

function tokenScreen(go, how, lock) {
  const input = h('input', { id: 'token', type: 'password', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: how === 'bootstrap' ? 'Código de instalação' : 'Código do convite' });
  const btn = h('button', { class: 'block', text: 'Entrar' });
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true;
    try {
      const v = input.value.trim();
      await session.enroll({ lock, how, token: v, setupCode: v });
      go('nickname');
    } catch (err) {
      btn.disabled = false;
      toast(err.status === 401 ? 'Convite inválido, usado ou vencido.' : err.code === 'circle_full' ? 'O círculo já tem 10 pessoas.' : `Não deu: ${err.message}`);
    }
  } }, h('label', { for: 'token', text: how === 'bootstrap' ? 'Código de instalação' : 'Cole o convite que você recebeu' }), input, btn);
  mount(h('main', {}, h('h1', { text: how === 'bootstrap' ? 'Instalação' : 'Convite' }), form));
}

// Aparelho novo: mostra o código para o aparelho antigo aprovar (V7-015).
async function pairScreen(go, lock) {
  let info;
  try { info = await session.pairStart(lock); } catch (e) { toast(`Não deu: ${e.message}`); return welcome(go); }
  const code = info.start.code.replace(/(\d{4})(\d{4})/, '$1 $2');
  const status = h('p', { class: 'muted', text: 'Esperando a aprovação no celular antigo…' });
  mount(h('main', {},
    h('h1', { text: 'Trocar de celular' }),
    h('p', { text: 'No celular antigo: Ajustes → Trocar de celular. Digite lá o pedido e o código abaixo e confira se a impressão digital é a mesma.' }),
    h('dl', { class: 'kv' },
      h('dt', { text: 'Pedido' }), h('dd', { class: 'code', text: info.start.pairingId }),
      h('dt', { text: 'Código' }), h('dd', { class: 'code big', text: code }),
      h('dt', { text: 'Impressão digital' }), h('dd', { class: 'code', text: info.fp })),
    h('p', { class: 'note', text: 'Faça isso com os dois celulares na mão. Ninguém de fora consegue adicionar um aparelho: não existe link para isso.' }),
    status));
  const until = Date.now() + 5 * 60_000;
  const tick = async () => {
    if (Date.now() > until) { status.textContent = 'O código venceu. Volte e comece de novo.'; return; }
    try {
      const st = await session.pairPoll(info);
      if (st === 'approved') { toast('Pronto. O celular antigo foi desconectado.'); return go('chats'); }
      if (st === 'expired') { status.textContent = 'O pedido venceu ou foi recusado.'; return; }
    } catch {}
    setTimeout(tick, 3000);
  };
  setTimeout(tick, 3000);
}
