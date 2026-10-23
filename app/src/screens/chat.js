// Conversa 1:1 ou grupo. Só horário (Brasília) em cada mensagem; nada de
// visto, entregue, online ou digitando (V6-022). Texto sempre como texto.
import { h, mount, header, toast, choiceSheet, confirmSheet } from '../ui.js';
import * as session from '../session.js';
import { formatTime, formatDateTime } from '../packages/protocol/src/time.js';
import { preparePhoto } from '../media.js';
import { openPhoto, holdButton } from './viewer.js';
import { roomMenu } from './room-menu.js';

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const EMOJIS = ['😀', '😂', '🥲', '😍', '😘', '😎', '🤔', '😴', '😢', '😡', '👍', '👎', '👏', '🙏', '💪', '❤️', '🔥', '✨', '🎉', '🌙', '☀️', '🌧️', '☕', '🍕'];

export async function chatScreen(go, { roomId }) {
  const S = session.S;
  let view = await session.roomView(roomId, true);
  if (!view) { toast('Conversa não encontrada.'); return go('chats'); }
  let replyTo = null;
  const log = h('ol', { class: 'messages', role: 'log', 'aria-live': 'polite' });
  const input = h('textarea', { id: 'composer', rows: '1', maxlength: '4000', placeholder: 'Mensagem', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': 'Mensagem' });
  const replyBar = h('div', { class: 'reply-bar', hidden: true });
  const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true });
  let onceNext = false;

  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    try {
      await S.client.sendText(roomId, text, replyTo ? { replyTo } : {});
      setReply(null);
      await render();
    } catch (e) { input.value = text; toast(e.code === 'gone' ? 'Conversa encerrada.' : `Não enviou: ${e.message}`); }
  };
  const setReply = (m) => {
    replyTo = m?.msgId ?? null;
    replyBar.hidden = !m;
    replyBar.replaceChildren(...(m ? [h('span', { class: 'muted', text: `Respondendo: ${preview(m)}` }), h('button', { class: 'icon', 'aria-label': 'Cancelar resposta', text: '×', onclick: () => setReply(null) })] : []));
  };

  fileIn.onchange = async () => {
    const f = fileIn.files[0];
    fileIn.value = '';
    if (!f) return;
    try {
      toast('Preparando a foto…');
      const p = await preparePhoto(f);
      await S.client.sendMedia(roomId, p.bytes, { mode: onceNext ? 'once' : 'media', mime: p.mime });
      p.bytes.fill(0);
      await render();
    } catch (e) { toast(`Não enviou: ${e.message}`); }
  };

  const attach = async () => {
    const c = await choiceSheet('Enviar foto', [{ label: 'Foto', value: 'media' }, { label: 'Foto de ver uma vez', value: 'once' }]);
    if (!c) return;
    onceNext = c === 'once';
    fileIn.click();
  };
  const emojiPanel = h('div', { class: 'emoji-panel', hidden: true }, EMOJIS.map((e) => h('button', { class: 'emoji', type: 'button', text: e, onclick: () => { input.value += e; input.focus(); } })));

  mount(h('div', { class: 'chat' },
    header(session.roomTitle(view), { back: () => go('chats'), actions: [h('button', { class: 'icon', 'aria-label': 'Menu da conversa', text: '⋮', onclick: async () => { const r = await roomMenu(go, roomId); if (r === 'refresh') { view = await session.roomView(roomId, true); chatScreen(go, { roomId }); } } })] }),
    h('div', { class: 'policy muted small', text: policyLine(view) }),
    log,
    view.closed ? h('p', { class: 'note center-text', text: 'Conversa encerrada. O que já existe continua só para leitura até vencer.' }) :
      h('footer', { class: 'composer' }, replyBar, emojiPanel,
        h('div', { class: 'row' },
          h('button', { class: 'icon', 'aria-label': 'Anexar foto', text: '+', onclick: attach }),
          input,
          h('button', { class: 'icon', 'aria-label': 'Emojis', text: '☺', onclick: () => { emojiPanel.hidden = !emojiPanel.hidden; } }),
          h('button', { class: 'send', 'aria-label': 'Enviar', text: '➤', onclick: send })),
        fileIn)));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });

  async function actions(m) {
    const mine = m.sender === S.client.userId;
    const opts = [{ label: 'Responder', value: 'reply' }];
    if (m.kind !== 'media' || m.body?.mode !== 'once') opts.push({ label: 'Reagir', value: 'react' });
    if (mine && m.kind === 'text') opts.push({ label: 'Editar', value: 'edit' });
    opts.push({ label: 'Apagar para mim', value: 'me', danger: true });
    if (mine) opts.push({ label: 'Apagar para todos', value: 'all', danger: true });
    const c = await choiceSheet(`Some em ${formatDateTime(m.expiresAt)} (horário de Brasília)`, opts);
    try {
      if (c === 'reply') { setReply(m); input.focus(); }
      if (c === 'react') { const e = await choiceSheet('Reação', REACTIONS.map((r) => ({ label: r, value: r }))); if (e) await S.client.react(roomId, m.msgId, e); }
      if (c === 'edit') {
        input.value = m.text;
        input.focus();
        const done = async () => { const t = input.value.trim(); input.value = ''; if (t && t !== m.text) await S.client.edit(roomId, m.msgId, t); await render(); };
        input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); input.onkeydown = null; done(); } };
        toast('Edite e aperte Enter. A mensagem fica com "*editado" e o mesmo prazo.');
      }
      if (c === 'me' && await confirmSheet('Apagar só para você? Os outros continuam vendo até vencer.', 'Apagar para mim')) await S.client.deleteForMe(m.msgId);
      if (c === 'all' && await confirmSheet('Apagar para todos? Some de todos os aparelhos assim que eles se conectarem.', 'Apagar para todos')) {
        if (m.kind === 'media') await S.client.api.post(`/v1/media/${m.body.mediaId}/revoke`).catch(() => {});
        await S.client.deleteForAll(roomId, m.msgId);
      }
      await render();
    } catch (e) { toast(`Não deu: ${e.message}`); }
  }

  function bubble(m, byId) {
    const mine = m.sender === S.client.userId;
    const parts = [];
    if (view.kind !== 'direct' && !mine) parts.push(h('span', { class: 'who', text: session.nameOf(m.sender) }));
    if (m.replyTo) parts.push(h('span', { class: 'quote', text: byId.get(m.replyTo) ? preview(byId.get(m.replyTo)) : 'Mensagem que não existe mais' }));
    if (m.kind === 'media') parts.push(mediaBlock(m, mine));
    else parts.push(h('span', { class: 'text', text: m.text }));
    const meta = [h('time', { text: formatTime(m.acceptedAt) })];
    if (m.edited) meta.push(h('span', { text: '*editado' }));
    const reacts = Object.values(m.reactions ?? {});
    if (reacts.length) meta.push(h('span', { class: 'reacts', text: reacts.join('') }));
    parts.push(h('span', { class: 'meta' }, meta));
    return h('li', { class: mine ? 'msg mine' : 'msg', onclick: (e) => { if (!e.target.closest('.hold, .open')) actions(m); } }, parts);
  }

  function mediaBlock(m, mine) {
    const load = () => S.client.openMedia(m);
    if (m.body.mode === 'once') {
      if (mine) return h('span', { class: 'media-tag', text: 'Foto de ver uma vez (enviada)' });
      if (m.consumed) return h('span', { class: 'media-tag', text: 'Foto de ver uma vez (já vista)' });
      return holdButton('Segure para ver (uma vez)', load, m.body.mime, async (err) => {
        if (err && !/410|404/.test(err.message)) toast(`Não abriu: ${err.message}`);
        await S.store.putMessage({ ...m, consumed: true });
      });
    }
    return h('button', { class: 'open media-tag', text: 'Foto · tocar para ver', onclick: () => openPhoto(load, m.body.mime).catch((e) => toast(`Não abriu: ${e.message}`)) });
  }

  async function render() {
    const r = await S.client.view(roomId);
    if (r.blocked) { log.replaceChildren(h('li', { class: 'note', text: 'Sem conexão confiável com o servidor: as mensagens ficam escondidas até reconectar.' })); return; }
    const byId = new Map(r.render.map((m) => [m.msgId, m]));
    log.replaceChildren(...(r.render.length ? r.render.map((m) => bubble(m, byId)) : [h('li', { class: 'note', text: 'Nenhuma mensagem.' })]));
    log.lastElementChild?.scrollIntoView({ block: 'end' });
  }

  await render();
  const timer = setInterval(() => render().catch(() => {}), 30_000); // vencidas somem sozinhas
  const off = session.onChange((w) => { if (w === 'synced') render().catch(() => {}); });
  return () => { clearInterval(timer); off(); };
}

function preview(m) {
  if (m.kind === 'media') return m.body?.mode === 'once' ? 'Foto de ver uma vez' : 'Foto';
  return (m.text ?? '').slice(0, 60);
}

function policyLine(v) {
  const d = (s) => (s % 86400 === 0 ? `${s / 86400} d` : `${s / 3600} h`);
  return `Mensagens somem em ${d(v.textTtl)} · mídia em ${d(v.mediaTtl)}`;
}
