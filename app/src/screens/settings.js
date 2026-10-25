// Ajustes: apelido, segurança, troca de celular, guardião, notificações,
// e a parte da administradora (convites, membros, recuperação).
import { h, mount, header, toast, confirmSheet, choiceSheet, errText } from '../ui.js';
import * as session from '../session.js';
import { CONFIG } from '../config.js';
import { formatDateTime } from '../packages/protocol/src/time.js';
import { avatar } from '../avatar.js';
import { readNativeAttachment } from '../attachment-picker.js';
import { preparePhoto } from '../media.js';
import { sensitiveScope } from '../sensitive-scope.js';
import { pickImage } from '../pick-image.js';

// Foto de perfil/grupo: quadrada, 512 px, sem metadados.
export const pickSquarePhoto = (facing = 'user', resume = { target: 'settings', action: 'profile' }) => pickImage({ maxSide: 512, square: true, facing, resume });

export async function settingsScreen(go, { attachment = null } = {}) {
  const S = session.S;
  const owner = sensitiveScope({ transient: false });
  const me = (await S.client.api.get('/v1/directory')).members;
  const { isAdmin } = await S.client.api.get('/v1/me');
  const fp = await session.myFingerprint();
  if (!owner.valid()) return;
  const aboutText = h('span', { id: 'about', text: session.aboutOf(S.client.userId) ?? '—' });
  const meAvatar = h('span', {}, avatar(session.myNickname(), session.photoOf(S.client.userId), { big: true }));
  const warnings = S.client.warnings.map((w) => h('li', { class: 'warn', text: warningText(w) }));

  mount(h('div', {},
    header('Ajustes', { back: () => go('chats') }),
    h('main', {},
      h('section', { class: 'card' },
        h('h2', { text: 'Você' }),
        h('div', { class: 'row' }, meAvatar,
          h('p', {}, 'Apelido: ', h('strong', { text: session.myNickname() ?? '—' }))),
        h('p', { class: 'muted small' }, 'Recado: ', aboutText),
        h('button', { class: 'secondary', text: 'Mudar apelido', onclick: () => go('nickname', { back: 'settings' }) }),
        h('button', { class: 'secondary', text: 'Recado', onclick: async () => {
          const t = await textSheet('Recado (até 140 letras, só o círculo vê, cifrado)', session.aboutOf(S.client.userId) ?? '', 140);
          if (t === null) return;
          try { await session.setAbout(t); aboutText.textContent = session.aboutOf(S.client.userId) ?? '—'; toast('Recado salvo.'); } catch (e) { toast(`Não deu: ${errText(e)}`); }
        } }),
        h('button', { class: 'secondary', text: 'Foto de perfil', onclick: async () => {
          const has = !!session.photoOf(S.client.userId);
          const c = has ? await choiceSheet('Foto de perfil (só o círculo vê, cifrada)', [{ label: 'Trocar foto', value: 'set' }, { label: 'Remover foto', value: 'rm', danger: true }]) : 'set';
          try {
            if (c === 'set') { const b = await pickSquarePhoto(); if (!b) return; await session.setProfilePhoto(b); b.fill(0); toast('Foto de perfil trocada. A anterior foi apagada.'); }
            if (c === 'rm') { await session.setProfilePhoto(null); toast('Foto de perfil removida.'); }
            // Atualiza só o avatar: a pessoa pode já ter saído desta tela.
            meAvatar.replaceChildren(avatar(session.myNickname(), session.photoOf(S.client.userId), { big: true }));
          } catch (e) { toast(`Não deu: ${errText(e)}`); }
        } })),
      h('section', { class: 'card' },
        h('h2', { text: 'Segurança' }),
        h('p', { class: 'muted small', text: 'Seu número de segurança (compare pessoalmente):' }),
        h('p', { class: 'code', text: fp }),
        h('p', { class: 'muted small' }, 'Versão do app: ', h('span', { class: 'code', text: CONFIG.versionCode }), '. Confira com o código publicado no GitHub.'),
        warnings.length ? h('ul', { class: 'list' }, warnings) : null,
        h('button', { class: 'secondary', text: 'Bloquear agora', onclick: async () => { await session.lock('manual'); go('unlock'); } })),
      h('section', { class: 'card' },
        h('h2', { text: 'Trocar de celular' }),
        h('p', { class: 'muted small', text: 'No celular novo, toque em "Já uso em outro celular". Ele mostra um pedido, um código e a impressão digital. Digite aqui os dois primeiros e confira o terceiro.' }),
        pairForm()),
      h('section', { class: 'card' },
        h('h2', { text: 'Guardião' }),
        h('p', { class: 'muted small', text: 'Se você perder o celular, a administradora e o seu guardião precisam autorizar, e ainda há 24 horas de espera com aviso a todos.' }),
        h('button', { class: 'secondary', text: 'Escolher guardião', onclick: () => chooseGuardian(me) })),
      h('section', { class: 'card' },
        h('h2', { text: 'Notificações' }),
        h('p', { class: 'muted small', text: 'O aviso diz só "novas mensagens". Sem nome, grupo, quantidade ou prévia. A Apple ou o Google ainda veem que houve um aviso e quando.' }),
        notificationsBox()),
      emergencySection(),
      h('section', { class: 'card' },
        h('h2', { text: 'Privacidade máxima' }),
        h('label', { class: 'switch' },
          h('input', { id: 'max-mode', type: 'checkbox', checked: session.maxMode(), onchange: async (e) => {
            await session.setPrefs({ maxMode: e.target.checked });
            toast(e.target.checked ? 'Modo máximo ligado: fotos e vídeos só pela câmera do app.' : 'Modo máximo desligado: a galeria volta a aparecer.');
          } }),
          h('span', {}, h('strong', { text: 'Modo máximo' }), h('br'),
            h('span', { class: 'muted small', text: 'Fotos e vídeos só pela câmera do app: nada vai para a galeria, para a nuvem ou para pastas temporárias, e o original com localização e modelo do aparelho nunca existe. Desligar permite escolher da galeria (o original continua lá).' })))),
      updateSection(),
      isAdmin ? adminSection(me) : null,
      h('section', { class: 'card' },
        h('h2', { text: 'O que este app não promete' }),
        h('p', { class: 'muted small', text: 'No iPhone não dá para bloquear print. Quem recebe pode fotografar a tela. O servidor não lê o conteúdo, mas vê horários, tamanhos aproximados e quem fala com quem. Leitores de tela do sistema leem o que aparece.' })),
      h('section', { class: 'card' },
        h('button', { class: 'danger block', text: 'Apagar tudo deste aparelho', onclick: async () => {
          if (await confirmSheet('Apagar todas as conversas e chaves deste aparelho? Não dá para desfazer.', 'Apagar tudo')) { await session.wipeEverything(); go('welcome'); }
        } })))));
  if (attachment?.pick.action === 'profile') {
    (async () => {
      let bytes;
      try {
        const file = await readNativeAttachment(attachment, { signal: owner.signal, allowed: owner.valid });
        ({ bytes } = await preparePhoto(file, { maxSide: 512, square: true }));
        if (!owner.valid()) return;
        await session.setProfilePhoto(bytes);
        if (owner.valid()) meAvatar.replaceChildren(avatar(session.myNickname(), session.photoOf(S.client.userId), { big: true }));
      } catch (e) { if (owner.valid()) toast(`Não abriu a foto: ${errText(e)}`); }
      finally { bytes?.fill(0); }
    })();
  }
  return () => owner.cancel();

}

// Estado sempre visível: aguardando permissão, ativado, recusado ou erro.
// Nunca fica calado: toda tentativa termina num desses estados.
const PUSH_TEXT = {
  checking: 'Conferindo…',
  off: 'Desativadas.',
  waiting: 'Aguardando permissão… responda à pergunta do sistema.',
  on: 'Ativadas neste aparelho.',
  denied: 'Recusadas. Para ativar, libere as notificações do app nas configurações do sistema e toque em "Tentar de novo".',

};
function notificationsBox() {
  const status = h('p', { id: 'push-state', class: 'small', role: 'status', 'aria-live': 'polite' });
  const btn = h('button', { id: 'push-btn', class: 'secondary' });
  const show = (state, detail) => {
    status.dataset.state = state;
    // Indisponível (sem service worker, ou Android sem serviços do Google) não
    // é erro: só explica. Erro de verdade aparece como "Erro: …".
    status.textContent = PUSH_TEXT[state] ?? (state === 'unavailable' ? detail : `Erro: ${detail ?? 'não deu para ativar.'}`);
    btn.disabled = state === 'waiting' || state === 'checking';
    btn.textContent = state === 'on' ? 'Desativar notificações' : state === 'denied' || state === 'error' || state === 'unavailable' ? 'Tentar de novo' : 'Ativar notificações';
  };
  btn.onclick = async () => {
    const turningOff = status.dataset.state === 'on';
    show('checking');
    try {
      await session.setPush(!turningOff, { onWaiting: () => show('waiting') });
      show(turningOff ? 'off' : 'on');
      toast(turningOff ? 'Notificações desativadas.' : 'Notificações ativadas.');
    } catch (e) {
      show(e.state ?? 'error', e.message);
    }
  };
  show('checking');
  session.pushState().then(({ state, detail }) => show(state, detail));
  return h('div', {}, status, btn);
}

function pairForm() {
  const id = h('input', { 'aria-label': 'Pedido', placeholder: 'Pedido', autocomplete: 'off', autocapitalize: 'off' });
  const code = h('input', { 'aria-label': 'Código', placeholder: 'Código de 8 números', inputmode: 'numeric', autocomplete: 'off' });
  const waiting = h('p', { id: 'pair-wait', class: 'muted small', role: 'status' });
  return h('form', { onsubmit: async (e) => {
    e.preventDefault();
    if (!await confirmSheet('Aprovar o celular novo? Quando ele terminar de guardar as chaves, este aqui será desconectado e apagado.', 'Aprovar')) return;
    try {
      await session.S.client.api.post('/v1/devices/pair/approve', { pairingId: id.value.trim(), code: code.value.replace(/\D/g, '') });
      // Duas fases: este continua valendo até o novo confirmar. Se o novo der
      // problema no meio, nada se perde.
      waiting.textContent = 'Aprovado. Esperando o celular novo terminar… Este aqui continua funcionando até lá. Se o novo der problema, é só começar de novo.';
      toast('Celular novo aprovado. Termine no celular novo.');
      session.waitReplaced({ onReplaced: () => location.reload() });
    } catch (err) { toast(err.status === 401 ? 'Código errado.' : 'Pedido não encontrado ou vencido.'); }
  } }, id, code, h('button', { class: 'secondary', text: 'Aprovar celular novo' }), waiting);
}

async function chooseGuardian(members) {
  const S = session.S;
  const u = await choiceSheet('Quem é seu guardião?', members.filter((m) => m.userId !== S.client.userId && m.state === 'active').map((m) => ({ label: session.nameOf(m.userId), value: m.userId })));
  if (!u) return;
  try { await S.client.api.post('/v1/me/guardian', { userId: u }); toast('Guardião definido.'); } catch (e) { toast(`Não deu: ${errText(e)}`); }
}

function adminSection(members) {
  const S = session.S;
  const out = h('p', { class: 'code small' });
  return h('section', { class: 'card' },
    h('h2', { text: 'Administradora' }),
    h('button', { class: 'secondary', text: 'Criar convite (uso único, 24 h)', onclick: async () => {
      try {
        const r = await S.client.api.post('/v1/invites', {});
        out.textContent = r.token;
        toast(`Convite vale até ${formatDateTime(r.expiresAt)}. Entregue em mão ou por canal seguro.`);
      } catch (e) { toast(e.code === 'circle_full' ? 'O círculo já tem 10 pessoas.' : `Não deu: ${errText(e)}`); }
    } }),
    out,
    h('h3', { text: 'Pessoas' }),
    h('ul', { class: 'list' }, members.filter((m) => m.userId !== S.client.userId).map((m) => h('li', {},
      h('span', { class: 'grow', text: `${session.nameOf(m.userId)}${m.state === 'frozen' ? ' (congelada)' : ''}` }),
      h('button', { class: 'secondary small', text: '…', 'aria-label': `Opções de ${session.nameOf(m.userId)}`, onclick: async () => {
        const c = await choiceSheet(session.nameOf(m.userId), [
          { label: m.state === 'frozen' ? 'Descongelar' : 'Congelar agora', value: 'freeze' },
          { label: 'Autorizar recuperação (perdeu o celular)', value: 'recover' },
          { label: 'Emitir convite de recuperação (após 24 h)', value: 'recinvite' },
          { label: 'Remover do círculo', value: 'remove', danger: true },
        ]);
        try {
          if (c === 'freeze') await S.client.api.post('/v1/admin/freeze', { userId: m.userId, frozen: m.state !== 'frozen' });
          if (c === 'recover') toast(`Recuperação: ${(await S.client.api.post('/v1/recovery/approve', { userId: m.userId })).state === 'waiting' ? 'espera de 24 h começou; todos foram avisados.' : 'falta o guardião autorizar.'}`);
          if (c === 'recinvite') { const r = await S.client.api.post('/v1/invites', { kind: 'recovery', forUser: m.userId }); out.textContent = r.token; }
          if (c === 'remove' && await confirmSheet(`Remover ${session.nameOf(m.userId)} do círculo?`, 'Remover')) await S.client.api.post('/v1/admin/remove', { userId: m.userId });
        } catch (e) { toast(e.code === 'too_early' ? 'Ainda não passaram as 24 horas.' : `Não deu: ${errText(e)}`); }
      } })))));
}

// Atualização (ADR 0006, V7-017): o service worker só troca de versão com
// aceite, depois de conferir assinatura e hashes. O código curto deve bater
// com o publicado no GitHub.
function updateSection() {
  const ctl = navigator.serviceWorker?.controller;
  if (!ctl) return null;
  let seq = 0;
  const ask = (msg) => new Promise((resolve) => {
    const id = ++seq + Math.random();
    const on = (ev) => { if (ev.data?.id === id) { navigator.serviceWorker.removeEventListener('message', on); resolve(ev.data); } };
    navigator.serviceWorker.addEventListener('message', on);
    navigator.serviceWorker.controller.postMessage({ id, ...msg });
  });
  const fmt = (c) => (c ? `${c.slice(0, 4)} ${c.slice(4, 8)}` : '—');
  const current = h('p', { class: 'code' });
  const offer = h('div', { hidden: true });
  ask({ type: 'status' }).then((r) => { current.textContent = r.pinned ? `v${r.pinned.version} · ${fmt(r.pinned.code)}` : '—'; });
  return h('section', { class: 'card' },
    h('h2', { text: 'Atualização' }),
    h('p', { class: 'muted small', text: 'Versão em uso (compare o código com o publicado no GitHub):' }), current,
    h('button', { class: 'secondary', text: 'Procurar atualização', onclick: async () => {
      const r = await ask({ type: 'check', channel: 'estavel' });
      if (!r.ok) return toast(r.refused ? `Nenhuma atualização aceita: ${r.error}.` : `Erro: ${r.error}`);
      offer.replaceChildren(
        h('p', {}, 'Versão nova ', h('strong', { text: `v${r.staged.version}` }), ' · código ', h('strong', { class: 'code', text: fmt(r.staged.code) })),
        h('p', { class: 'muted small', text: 'Assinatura e arquivos já conferidos. Confira o código antes de aceitar.' }),
        h('button', { text: 'Aceitar e atualizar', onclick: async () => {
          if (!await confirmSheet(`Atualizar para v${r.staged.version} (código ${fmt(r.staged.code)})?`, 'Atualizar')) return;
          const a = await ask({ type: 'apply' });
          if (!a.ok) return toast(`Erro: ${a.error}`);
          await session.lock('update');
          location.reload();
        } }));
      offer.hidden = false;
    } }),
    offer);
}

function warningText(w) {
  switch (w.kind) {
    case 'key_changed': return `${session.nameOf(w.userId)} trocou de chave (aparelho novo ou recuperação). Verifiquem os números pessoalmente.`;
    case 'message_rejected': return `Uma mensagem de ${session.nameOf(w.userId)} não passou na verificação e foi descartada sem abrir. Se repetir, verifiquem os números pessoalmente.`;
    case 'unconfirmed_member': return 'O servidor indicou numa conversa alguém que a líder não anunciou. Nada foi enviado. Avisem a líder.';
    case 'ttl_clamped': return 'O servidor tentou dar a uma mensagem um prazo maior que o combinado. O aparelho manteve o prazo certo.';
    case 'membership_rejected': return `Um anúncio de membros de ${session.nameOf(w.from)} não veio da líder confirmada e foi ignorado.`;
    default: return 'Aviso de segurança. Verifiquem os números pessoalmente.';
  }
}

// Caixa de texto em folha (sem prompt() do navegador).
function textSheet(label, value, max) {
  return new Promise((resolve) => {
    const input = h('input', { id: 'sheet-text', value, maxlength: String(max), autocomplete: 'off', 'aria-label': label });
    const close = (v) => { sheet.remove(); resolve(v); };
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, h('form', { class: 'sheet-box', onsubmit: (e) => { e.preventDefault(); close(input.value); } },
      h('p', { class: 'muted', text: label }), input,
      h('button', { class: 'block', text: 'Salvar' }), h('button', { type: 'button', class: 'secondary block', text: 'Cancelar', onclick: () => close(null) })));
    document.body.append(sheet);
    input.focus();
  });
}

// Proteções de emergência (ADR 0014): tudo depende da parte do servidor.
function emergencySection() {
  const S = session.S;
  const days = S.prefs.deadDays ?? session.DEFAULT_DEAD_DAYS;
  const sel = h('select', { id: 'dead-days', 'aria-label': 'Apagar se o aparelho sumir por' },
    [[1, '1 dia'], [3, '3 dias'], [7, '7 dias'], [15, '15 dias'], [30, '30 dias'], [0, 'Nunca (desligado)']].map(([v, t]) => h('option', { value: String(v), text: t, selected: v === days })));
  sel.onchange = async () => {
    try { await session.setDeadDays(Number(sel.value)); toast(Number(sel.value) ? `Se este aparelho ficar ${sel.selectedOptions[0].text} sem abrir o app, a chave dele é destruída.` : 'Interruptor desligado.'); }
    catch (e) { toast(`Não deu: ${errText(e)}`); }
  };
  const duressBtn = h('button', { class: 'secondary', text: S.prefs.duressSet ? 'Trocar PIN de coação' : 'Criar PIN de coação', onclick: async () => {
    const pin = await pinSheet('PIN de coação: se alguém te obrigar a abrir o app, digite este no lugar do seu. O app abre vazio, como novo, e tudo deste aparelho é destruído sem aviso. Precisa ser diferente do seu PIN.');
    if (!pin) return;
    try { await session.setDuressPin(pin); duressBtn.textContent = 'Trocar PIN de coação'; toast('PIN de coação criado.'); }
    catch (e) { toast(e.code === 'same_as_pin' ? 'Tem que ser diferente do seu PIN.' : `Não deu: ${errText(e)}`); }
  } });
  const killBtn = h('button', { class: 'secondary', text: S.prefs.killCodeSet ? 'Gerar novo código de emergência' : 'Gerar código de emergência', onclick: async () => {
    if (S.prefs.killCodeSet && !await confirmSheet('O código anterior deixa de valer. Continuar?', 'Gerar novo')) return;
    try {
      const code = await session.createKillCode();
      const box = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'sheet-box' },
        h('p', { text: 'Anote no papel e guarde longe do celular (ou entregue ao seu guardião). Se perder o celular ou ele for levado, abra o app em qualquer aparelho → "Perdi meu celular" e digite este código: o celular perdido vira ruído na hora.' }),
        h('p', { class: 'code big', id: 'kill-code', text: code.match(/.{1,4}/g).join(' ') }),
        h('p', { class: 'muted small', text: 'Ele aparece só agora. O servidor guarda só um resumo dele.' }),
        h('button', { class: 'block', text: 'Já anotei', onclick: () => box.remove() })));
      document.body.append(box);
      killBtn.textContent = 'Gerar novo código de emergência';
    } catch (e) { toast(`Não deu: ${errText(e)}`); }
  } });
  return h('section', { class: 'card' },
    h('h2', { text: 'Proteções de emergência' }),
    h('p', { class: 'muted small', text: 'A chave deste aparelho depende do Face ID, do seu PIN e de uma parte guardada no servidor. Quem copia o celular não consegue testar PINs: é o servidor que conta os erros (5 errados seguidos e a chave é destruída).' }),
    h('label', { for: 'dead-days', text: 'Destruir a chave se o aparelho ficar sem abrir o app por' }), sel,
    duressBtn, killBtn,
    h('label', { for: 'lock-after', text: 'Trancar (tirar as chaves da memória) ao sair do app' }), lockSel());
}

function lockSel() {
  const cur = session.S.prefs.lockAfter ?? 0;
  const sel = h('select', { id: 'lock-after' }, [[0, 'Na hora'], [60_000, 'Depois de 1 minuto'], [300_000, 'Depois de 5 minutos']].map(([v, t]) => h('option', { value: String(v), text: t, selected: v === cur })));
  sel.onchange = () => session.setPrefs({ lockAfter: Number(sel.value) }).then(() => toast('Salvo.'));
  return sel;
}

function pinSheet(label) {
  return new Promise((resolve) => {
    const a = h('input', { id: 'pin-a', type: 'password', inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'PIN' });
    const b = h('input', { id: 'pin-b', type: 'password', inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Repita o PIN' });
    const close = (v) => { sheet.remove(); resolve(v); };
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, h('form', { class: 'sheet-box', onsubmit: (e) => {
      e.preventDefault();
      if (!/^\d{6,12}$/.test(a.value)) return toast('Use de 6 a 12 números.');
      if (a.value !== b.value) return toast('Os dois campos não são iguais.');
      close(a.value);
    } }, h('p', { class: 'muted', text: label }), a, b, h('button', { class: 'block', text: 'Salvar' }), h('button', { type: 'button', class: 'secondary block', text: 'Cancelar', onclick: () => close(null) })));
    document.body.append(sheet);
    a.focus();
  });
}
