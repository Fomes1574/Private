// Conversa 1:1 ou grupo. Só horário (Brasília) em cada mensagem; nada de
// visto, entregue, online ou digitando (V6-022). Texto sempre como texto.
import { h, mount, header, toast, choiceSheet, confirmSheet, errText } from '../ui.js';
import * as session from '../session.js';
import { formatTime, formatDateTime } from '../packages/protocol/src/time.js';
import { preparePhoto } from '../media.js';
import { editPhoto } from '../editor.js';
import { openMedia, holdButton, playAudio, openText } from './viewer.js';
import { MAX_DOC_BYTES } from '../packages/protocol/src/documents.js';
import { validDocName } from '../packages/protocol/src/envelope.js';
import { prepareVideo } from '../video-prep.js';
import { startRecording, fmtDuration } from '../audio.js';
import { roomMenu } from './room-menu.js';
import { normalize } from '../packages/protocol/src/nickname.js';

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const EMOJIS = ['😀', '😂', '🥲', '😍', '😘', '😎', '🤔', '😴', '😢', '😡', '👍', '👎', '👏', '🙏', '💪', '❤️', '🔥', '✨', '🎉', '🌙', '☀️', '🌧️', '☕', '🍕'];

export async function chatScreen(go, { roomId }) {
  const S = session.S;
  let view = await session.roomView(roomId, true);
  if (!view) { toast('Conversa não encontrada.'); return go('chats'); }
  let replyTo = null;
  // Busca local (V7-021): só no que ainda vale, na memória, sem índice salvo.
  let term = '';
  const searchIn = h('input', { id: 'chat-search', type: 'search', placeholder: 'Buscar nesta conversa', autocomplete: 'off', 'aria-label': 'Buscar nesta conversa' });
  const searchBar = h('div', { class: 'search-bar row', hidden: true }, searchIn,
    h('button', { class: 'icon', 'aria-label': 'Fechar busca', text: '×', onclick: () => { term = ''; searchIn.value = ''; searchBar.hidden = true; render(); } }));
  searchIn.oninput = () => { term = normalize(searchIn.value.trim()); render(); };
  const log = h('ol', { class: 'messages', role: 'log', 'aria-live': 'polite' });
  const input = h('textarea', { id: 'composer', rows: '1', maxlength: '4000', placeholder: 'Mensagem', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': 'Mensagem' });
  const replyBar = h('div', { class: 'reply-bar', hidden: true });
  const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true });
  let pick = { video: false, once: false, doc: false };
  const progressBar = h('div', { class: 'progress', hidden: true });
  let videoJob = null;

  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    try {
      await S.client.sendText(roomId, text, replyTo ? { replyTo } : {});
      clearTimeout(draftTimer);
      await session.setDraft(roomId, '');
      setReply(null);
      await render();
    } catch (e) { input.value = text; toast(e.code === 'gone' ? 'Conversa encerrada.' : `Não enviou: ${errText(e)}`); }
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
    const { video, once, doc } = pick;
    if (doc) return sendDoc(f);
    if (video) return sendVideo(f, once);
    try {
      const prepared = await preparePhoto(f); // recodificada, sem metadados
      const p = await editPhoto(prepared.bytes, prepared.mime);
      prepared.bytes.fill(0);
      if (!p) return; // cancelou no editor
      const caption = takeCaption(once);
      await S.client.sendMedia(roomId, p.bytes, { mode: once ? 'once' : 'media', mime: p.mime, caption });
      p.bytes.fill(0);
      await render();
    } catch (e) { toast(`Não enviou: ${errText(e)}`); }
  };

  // Legenda (V6-025): o que estiver escrito na caixa vai junto, cifrado.
  // Ver uma vez não leva legenda (ela ficaria visível sem segurar).
  function takeCaption(once) {
    const t = input.value.trim().slice(0, 1000);
    if (once || !t) return undefined;
    input.value = '';
    session.setDraft(roomId, '').catch(() => {});
    return t;
  }

  // Vídeo (§14, V7-016): sempre recodificado no aparelho (até 5 min, 1080p,
  // sem metadados) antes de cifrar. Se ficar grande demais, tenta a
  // qualidade econômica; se ainda não couber, não envia nada.
  async function sendVideo(file, once) {
    if (videoJob) return toast('Já há um vídeo sendo preparado.');
    const ctl = new AbortController();
    videoJob = ctl;
    const bar = h('progress', { max: '1', value: '0' });
    const label = h('span', { class: 'muted small', text: 'Preparando o vídeo…' });
    progressBar.replaceChildren(label, bar, h('button', { class: 'secondary small', text: 'Cancelar', onclick: () => ctl.abort() }));
    progressBar.hidden = false;
    let bytes = null;
    try {
      let duration;
      try {
        ({ bytes, duration } = await prepareVideo(file, {
          signal: ctl.signal,
          onProgress: (p) => { bar.value = p; },
          onStage: (preset) => { label.textContent = preset === 'padrao' ? 'Preparando o vídeo…' : 'Ficou grande; reduzindo a qualidade…'; },
        }));
      } catch (e) {
        if (ctl.signal.aborted) return toast('Cancelado. Nada foi enviado.');
        throw e;
      }
      label.textContent = 'Enviando cifrado…';
      bar.removeAttribute('value');
      await S.client.sendMedia(roomId, bytes, { mode: once ? 'once' : 'media', mime: 'video/mp4', duration, caption: takeCaption(once) });
      await render();
    } catch (e) { toast(`Não enviou: ${errText(e)}`); }
    finally { bytes?.fill(0); videoJob = null; progressBar.hidden = true; progressBar.replaceChildren(); }
  }

  // Documento (§16, P-12): por enquanto só texto UTF-8, mostrado como texto
  // puro dentro do app. Três ativos por pessoa no app inteiro; o quarto
  // revoga o mais antigo para todos, então avisa antes.
  async function sendDoc(file) {
    let bytes = null;
    try {
      if (file.size > MAX_DOC_BYTES) throw new Error('documento acima de 20 MB.');
      bytes = new Uint8Array(await file.arrayBuffer());
      try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('só documentos de texto (UTF-8) por enquanto.'); }
      if (bytes.includes(0)) throw new Error('arquivo binário: só documentos de texto por enquanto.');
      const q = await S.client.api.get('/v1/docs/mine');
      if (q.active >= q.max && !await confirmSheet(`Você já tem ${q.max} documentos ativos no app. Enviar este apaga o mais antigo para todos, em qualquer conversa.`, 'Enviar mesmo assim')) return;
      let name = file.name.replace(/[\u0000-\u001f\u007f/\\]/g, '').trim().slice(0, 100);
      if (!validDocName(name)) name = 'documento.txt';
      const m = await S.client.sendMedia(roomId, bytes, { mode: 'doc', mime: 'text/plain;charset=utf-8', name });
      if (m.quota?.evicted?.length) toast('Documento enviado. O mais antigo foi apagado para todos (limite de 3).');
      await render();
    } catch (e) { toast(`Não enviou: ${errText(e)}`); }
    finally { bytes?.fill(0); }
  }

  const attach = async () => {
    const c = await choiceSheet('Enviar', [
      { label: 'Foto', value: 'photo' }, { label: 'Foto de ver uma vez', value: 'photo-once' },
      { label: 'Vídeo (até 5 min)', value: 'video' }, { label: 'Vídeo de ver uma vez', value: 'video-once' },
      { label: 'Documento de texto (até 20 MB)', value: 'doc' }]);
    if (!c) return;
    pick = { video: c.startsWith('video'), once: c.endsWith('-once'), doc: c === 'doc' };
    fileIn.accept = pick.doc ? '.txt,.md,.csv,text/plain' : pick.video ? 'video/*' : 'image/*';
    fileIn.click();
  };
  // Microfone: tocar para gravar; enviar ou descartar. Até 1 hora.
  const recBar = h('div', { class: 'rec-bar', hidden: true });
  let recording = null;
  const mic = async () => {
    if (recording) return;
    try {
      const timer = h('span', { class: 'code', text: '0:00' });
      recording = await startRecording({ onTick: (ms) => { timer.textContent = fmtDuration(ms); }, onLimit: () => toast('Limite de 1 hora: gravação encerrada.') });
      recBar.replaceChildren(h('span', { class: 'rec-dot', 'aria-hidden': 'true' }), h('span', { text: 'Gravando ' }), timer,
        h('button', { class: 'secondary small', text: 'Descartar', onclick: () => { recording.cancel(); recording = null; recBar.hidden = true; } }),
        h('button', { class: 'small', text: 'Enviar áudio', onclick: async () => {
          const r = await recording.stop();
          recording = null; recBar.hidden = true;
          if (r.ms < 700) { r.bytes.fill(0); return toast('Áudio curto demais.'); }
          try { await S.client.sendMedia(roomId, r.bytes, { mode: 'media', mime: r.mime, duration: r.ms }); await render(); }
          catch (e) { toast(`Não enviou: ${errText(e)}`); } finally { r.bytes.fill(0); }
        } }));
      recBar.hidden = false;
    } catch (e) { recording = null; toast(e.name === 'NotAllowedError' ? 'Microfone negado.' : `Não deu para gravar: ${errText(e)}`); }
  };

  const emojiPanel = h('div', { class: 'emoji-panel', hidden: true }, EMOJIS.map((e) => h('button', { class: 'emoji', type: 'button', text: e, onclick: () => { input.value += e; input.focus(); } })));

  mount(h('div', { class: 'chat' },
    header(session.roomTitle(view), { back: () => go('chats'), actions: [h('button', { class: 'icon', 'aria-label': 'Menu da conversa', text: '⋮', onclick: async () => { const r = await roomMenu(go, roomId); if (r === 'search') { searchBar.hidden = false; searchIn.focus(); return; } if (r === 'refresh') { view = await session.roomView(roomId, true); chatScreen(go, { roomId }); } } })] }),
    h('div', { class: 'policy muted small', text: policyLine(view) }),
    searchBar,
    log,
    view.closed ? h('p', { class: 'note center-text', text: 'Conversa encerrada. O que já existe continua só para leitura até vencer.' }) :
      h('footer', { class: 'composer' }, replyBar, recBar, progressBar, emojiPanel,
        h('div', { class: 'row' },
          h('button', { class: 'icon', 'aria-label': 'Anexar foto ou vídeo', text: '+', onclick: attach }),
          input,
          h('button', { class: 'icon', 'aria-label': 'Emojis', text: '☺', onclick: () => { emojiPanel.hidden = !emojiPanel.hidden; } }),
          h('button', { class: 'icon', 'aria-label': 'Gravar áudio', text: '🎙', onclick: mic }),
          h('button', { class: 'send', 'aria-label': 'Enviar', text: '➤', onclick: send })),
        fileIn)));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  // Rascunho: volta ao reabrir a conversa (cifrado no aparelho).
  let draftTimer = null, editing = false;
  const draft = await session.getDraft(roomId);
  if (!input.value) input.value = draft;
  const saveDraft = () => { if (!editing) session.setDraft(roomId, input.value.trim() ? input.value : '').catch(() => {}); };
  input.addEventListener('input', () => { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 500); });

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
        editing = true;
        input.value = m.text;
        input.focus();
        const done = async () => { editing = false; const t = input.value.trim(); input.value = ''; if (t && t !== m.text) await S.client.edit(roomId, m.msgId, t); await render(); };
        input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); input.onkeydown = null; done(); } };
        toast('Edite e aperte Enter. A mensagem fica com "*editado" e o mesmo prazo.');
      }
      if (c === 'me' && await confirmSheet('Apagar só para você? Os outros continuam vendo até vencer.', 'Apagar para mim')) await S.client.deleteForMe(m.msgId);
      if (c === 'all' && await confirmSheet('Apagar para todos? Some de todos os aparelhos assim que eles se conectarem.', 'Apagar para todos')) {
        if (m.kind === 'media') await S.client.api.post(`/v1/media/${m.body.mediaId}/revoke`).catch(() => {});
        await S.client.deleteForAll(roomId, m.msgId);
      }
      await render();
    } catch (e) { toast(`Não deu: ${errText(e)}`); }
  }

  function bubble(m, byId) {
    const mine = m.sender === S.client.userId;
    const parts = [];
    if (view.kind !== 'direct' && !mine) parts.push(h('span', { class: 'who', text: session.nameOf(m.sender) }));
    if (m.replyTo) parts.push(h('span', { class: 'quote', text: byId.get(m.replyTo) ? preview(byId.get(m.replyTo)) : 'Mensagem que não existe mais' }));
    if (m.kind === 'media') {
      parts.push(mediaBlock(m, mine));
      if (m.body?.caption) parts.push(h('span', { class: 'text caption', text: m.body.caption }));
    }
    else parts.push(h('span', { class: 'text', text: m.text }));
    const meta = [h('time', { text: formatTime(m.acceptedAt) })];
    if (m.edited) meta.push(h('span', { text: '*editado' }));
    const reacts = Object.values(m.reactions ?? {});
    if (reacts.length) meta.push(h('span', { class: 'reacts', text: reacts.join('') }));
    parts.push(h('span', { class: 'meta' }, meta));
    return h('li', { class: mine ? 'msg mine' : 'msg', onclick: (e) => { if (!e.target.closest('.hold, .open, .audio-box')) actions(m); } }, parts);
  }

  function mediaBlock(m, mine) {
    const load = () => S.client.openMedia(m);
    const what = mediaName(m);
    if (m.body.mode === 'doc') {
      if (!m.body.key) return h('span', { class: 'media-tag', text: `Documento · ${m.body.name ?? ''}` });
      return h('button', { class: 'open media-tag', text: `Documento · ${m.body.name ?? 'sem nome'} · abrir`, onclick: () => openText(load, m.body.name).catch((e) => toast(`Não abriu: ${errText(e)}`)) });
    }
    if (m.body.mode === 'once') {
      const a = what === 'Foto' ? 'a' : 'o';
      if (mine) return h('span', { class: 'media-tag', text: `${what} de ver uma vez (enviad${a})` });
      if (m.consumed || !m.body.key) return h('span', { class: 'media-tag', text: `${what} de ver uma vez (já vist${a})` });
      // O núcleo do cliente já apaga a chave depois da tentativa; aqui só redesenha.
      return holdButton('Segure para ver (uma vez)', load, m.body.mime, async (err) => {
        if (err && !/410|404/.test(err.message)) toast(`Não abriu: ${errText(err)}`);
        setTimeout(() => render().catch(() => {}), 300);
      });
    }
    if (/^audio\//.test(m.body.mime)) {
      const host = h('span', { class: 'audio-host' });
      return h('span', {}, h('button', { class: 'open media-tag', text: `Áudio · ${fmtDuration(m.body.duration ?? 0)} · tocar`, onclick: () => playAudio(load, m.body.mime, host).catch((e) => toast(`Não tocou: ${errText(e)}`)) }), host);
    }
    const label = what === 'Vídeo' ? `Vídeo · ${fmtDuration(m.body.duration ?? 0)} · tocar para ver` : 'Foto · tocar para ver';
    return h('button', { class: 'open media-tag', text: label, onclick: () => openMedia(load, m.body.mime).catch((e) => toast(`Não abriu: ${errText(e)}`)) });
  }

  async function render() {
    const r = await S.client.view(roomId);
    if (r.blocked) { log.replaceChildren(h('li', { class: 'note', text: 'Sem conexão confiável com o servidor: as mensagens ficam escondidas até reconectar.' })); return; }
    const byId = new Map(r.render.map((m) => [m.msgId, m]));
    const list = term ? r.render.filter((m) => normalize((m.kind === 'media' ? m.body?.caption ?? m.body?.name ?? '' : m.text) ?? '').includes(term)) : r.render;
    log.replaceChildren(...(list.length ? list.map((m) => bubble(m, byId)) : [h('li', { class: 'note', text: term ? 'Nada encontrado no que ainda não venceu.' : 'Nenhuma mensagem.' })]));
    log.lastElementChild?.scrollIntoView({ block: 'end' });
  }

  // Fundo do grupo (cifrado, escolhido pela líder): imagem por CSSOM, sem
  // estilo em linha (CSP).
  const bg = view.kind === 'group' ? S.rooms[roomId]?.background : null;
  if (bg) session.visualURL(bg).then((url) => { if (url) { log.style.backgroundImage = `url("${url}")`; log.classList.add('has-bg'); } });

  await render();
  const timer = setInterval(() => render().catch(() => {}), 30_000); // vencidas somem sozinhas
  const off = session.onChange((w) => { if (w === 'synced') render().catch(() => {}); });
  return () => { clearInterval(timer); off(); if (draftTimer) { clearTimeout(draftTimer); saveDraft(); } };
}

function mediaName(m) {
  if (m.body?.mode === 'doc') return 'Documento';
  const mime = m.body?.mime ?? '';
  return /^audio\//.test(mime) ? 'Áudio' : /^video\//.test(mime) ? 'Vídeo' : 'Foto';
}

function preview(m) {
  if (m.kind === 'media') return m.body?.mode === 'once' ? `${mediaName(m)} de ver uma vez` : mediaName(m);
  return (m.text ?? '').slice(0, 60);
}

function policyLine(v) {
  const d = (s) => (s % 86400 === 0 ? `${s / 86400} d` : `${s / 3600} h`);
  return `Mensagens somem em ${d(v.textTtl)} · mídia em ${d(v.mediaTtl)}`;
}
