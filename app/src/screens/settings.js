// Ajustes: apelido, segurança, troca de celular, guardião, notificações,
// e a parte da administradora (convites, membros, recuperação).
import { h, mount, header, toast, confirmSheet, choiceSheet } from '../ui.js';
import * as session from '../session.js';
import { CONFIG } from '../config.js';
import { formatDateTime } from '../packages/protocol/src/time.js';

export async function settingsScreen(go) {
  const S = session.S;
  const me = (await S.client.api.get('/v1/directory')).members;
  const { isAdmin } = await S.client.api.get('/v1/me');
  const fp = await session.myFingerprint();
  const warnings = S.client.warnings.map((w) => h('li', { class: 'warn', text: `${session.nameOf(w.userId)} trocou de chave (aparelho novo ou recuperação). Verifiquem os números pessoalmente.` }));

  mount(h('div', {},
    header('Ajustes', { back: () => go('chats') }),
    h('main', {},
      h('section', { class: 'card' },
        h('h2', { text: 'Você' }),
        h('p', {}, 'Apelido: ', h('strong', { text: session.myNickname() ?? '—' })),
        h('button', { class: 'secondary', text: 'Mudar apelido', onclick: () => go('nickname', { back: 'settings' }) })),
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
        h('button', { class: 'secondary', text: 'Ativar notificações', onclick: () => session.enablePush().then(() => toast('Notificações ativadas.')).catch((e) => toast(e.message)) })),
      updateSection(),
      isAdmin ? adminSection(me) : null,
      h('section', { class: 'card' },
        h('h2', { text: 'O que este app não promete' }),
        h('p', { class: 'muted small', text: 'No iPhone não dá para bloquear print. Quem recebe pode fotografar a tela. O servidor não lê o conteúdo, mas vê horários, tamanhos aproximados e quem fala com quem. Leitores de tela do sistema leem o que aparece.' })),
      h('section', { class: 'card' },
        h('button', { class: 'danger block', text: 'Apagar tudo deste aparelho', onclick: async () => {
          if (await confirmSheet('Apagar todas as conversas e chaves deste aparelho? Não dá para desfazer.', 'Apagar tudo')) { await session.wipeEverything(); go('welcome'); }
        } })))));
}

function pairForm() {
  const id = h('input', { 'aria-label': 'Pedido', placeholder: 'Pedido', autocomplete: 'off', autocapitalize: 'off' });
  const code = h('input', { 'aria-label': 'Código', placeholder: 'Código de 8 números', inputmode: 'numeric', autocomplete: 'off' });
  return h('form', { onsubmit: async (e) => {
    e.preventDefault();
    if (!await confirmSheet('Aprovar o celular novo? Este aqui vai ser desconectado na hora.', 'Aprovar')) return;
    try {
      await session.S.client.api.post('/v1/devices/pair/approve', { pairingId: id.value.trim(), code: code.value.replace(/\D/g, '') });
      toast('Celular novo aprovado. Este foi desconectado.');
      await session.wipeEverything();
      location.reload();
    } catch (err) { toast(err.status === 401 ? 'Código errado.' : 'Pedido não encontrado ou vencido.'); }
  } }, id, code, h('button', { class: 'secondary', text: 'Aprovar celular novo' }));
}

async function chooseGuardian(members) {
  const S = session.S;
  const u = await choiceSheet('Quem é seu guardião?', members.filter((m) => m.userId !== S.client.userId && m.state === 'active').map((m) => ({ label: session.nameOf(m.userId), value: m.userId })));
  if (!u) return;
  try { await S.client.api.post('/v1/me/guardian', { userId: u }); toast('Guardião definido.'); } catch (e) { toast(`Não deu: ${e.message}`); }
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
      } catch (e) { toast(e.code === 'circle_full' ? 'O círculo já tem 10 pessoas.' : `Não deu: ${e.message}`); }
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
        } catch (e) { toast(e.code === 'too_early' ? 'Ainda não passaram as 24 horas.' : `Não deu: ${e.message}`); }
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
