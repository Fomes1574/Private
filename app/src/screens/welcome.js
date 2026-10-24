// Entrada sem conta (§5): "Tenho um convite" e "Já uso em outro celular".
// Não existe "criar conta". A primeira pessoa (administradora) usa o código
// de instalação, só pelo endereço com #instalar.
import { h, mount, toast, confirmSheet } from '../ui.js';
import * as session from '../session.js';
import { lockSetupForm } from './lock-setup.js';

const TAGLINE = 'O único lugar verdadeiramente seguro para o pacto.';

export function welcome(go) {
  const isSetup = location.hash === '#instalar';
  mount(h('main', { class: 'center' },
    h('div', { class: 'brand' }, h('div', { class: 'logo', 'aria-hidden': 'true' }), h('h1', { class: 'brand-name', text: 'Pacto Talk' }), h('p', { class: 'muted', text: TAGLINE })),
    isSetup
      ? h('button', { class: 'block', text: 'Instalar a primeira pessoa', onclick: () => withLock(go, 'bootstrap') })
      : [
        h('button', { class: 'block', text: 'Tenho um convite', onclick: () => withLock(go, 'invite') }),
        h('button', { class: 'block secondary', text: 'Já uso em outro celular', onclick: () => withLock(go, 'pair') }),
        h('button', { class: 'link', text: 'Perdi meu celular (código de emergência)', onclick: () => emergency(go) }),
        // Também disponível no APK nativo, que não é aberto com #instalar.
        // Exige o código de instalação: antes do primeiro membro, cria o
        // círculo; depois, recupera a conta de administradora (R-01).
        h('button', { class: 'link', text: 'Administradora: instalar ou recuperar', onclick: () => withLock(go, 'bootstrap') }),
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
      await session.enroll({ lock, how, token: v, setupCode: v,
        confirmRecover: () => confirmSheet('O círculo já existe. Recuperar a conta de administradora neste aparelho? O aparelho antigo deixa de valer, os contatos vão ver que a sua chave de segurança mudou e o histórico do aparelho antigo não volta.', 'Recuperar') });
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
  return pairWaitScreen(go, info);
}

// Também é a tela de volta quando o app fechou no meio da troca (o pedido
// já está guardado; ao desbloquear, o app continua daqui).
export function pairWaitScreen(go, info) {
  const code = String(info.code).replace(/(\d{4})(\d{4})/, '$1 $2');
  const status = h('p', { class: 'muted', role: 'status', text: 'Esperando a aprovação no celular antigo… Pode trocar de app; não feche este.' });
  mount(h('main', {},
    h('h1', { text: 'Trocar de celular' }),
    h('p', { text: 'No celular antigo: Ajustes → Trocar de celular. Digite lá o pedido e o código abaixo e confira se a impressão digital é a mesma.' }),
    h('dl', { class: 'kv' },
      h('dt', { text: 'Pedido' }), h('dd', { class: 'code', text: info.pairingId }),
      h('dt', { text: 'Código' }), h('dd', { class: 'code big', text: code }),
      h('dt', { text: 'Impressão digital' }), h('dd', { class: 'code', text: info.fp })),
    h('p', { class: 'note', text: 'O código vale 5 minutos. Faça isso com os dois celulares na mão. Ninguém de fora consegue adicionar um aparelho: não existe link para isso.' }),
    status));
  let stop = false;
  const tick = async () => {
    if (stop) return;
    try {
      const st = await session.pairPoll(info);
      if (st === 'approved') { toast('Pronto. O celular antigo vai ser desconectado.'); return go('chats'); }
      if (st === 'expired') { stop = true; await session.wipeEverything(); toast('O pedido venceu ou foi recusado. Comece de novo.'); return welcome(go); }
    } catch {}
    setTimeout(tick, 3000);
  };
  setTimeout(tick, 3000);
  return () => { stop = true; };
}

// Código de emergência (ADR 0014): de qualquer aparelho, sem conta.
function emergency(go) {
  const input = h('input', { id: 'kill', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'xxxx xxxx xxxx xxxx xxxx xxxx' });
  mount(h('main', {},
    h('h1', { text: 'Perdi meu celular' }),
    h('p', { text: 'Digite o código de emergência que você anotou. O celular perdido perde a chave na hora: o que está guardado nele vira ruído e a sessão cai. Depois, peça à administradora a recuperação da conta.' }),
    h('form', { onsubmit: async (e) => {
      e.preventDefault();
      try { await session.useKillCode(input.value); input.value = ''; toast('Pronto. Se o código estiver certo, o celular perdido já não abre mais nada.'); welcome(go); }
      catch (err) { toast(err.message); }
    } }, h('label', { for: 'kill', text: 'Código de emergência' }), input, h('button', { class: 'block danger', text: 'Destruir o celular perdido' })),
    h('button', { class: 'link', text: 'Voltar', onclick: () => welcome(go) })));
}
