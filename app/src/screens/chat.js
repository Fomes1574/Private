// Conversa 1:1 ou grupo. Só horário (Brasília) em cada mensagem; nada de
// visto, entregue, online ou digitando (V6-022). Texto sempre como texto.
import { h, mount, header, toast, choiceSheet, confirmSheet, errText } from '../ui.js';
import * as session from '../session.js';
import { formatTime, formatDateTime } from '../packages/protocol/src/time.js';
import { preparePhoto } from '../media.js';
import { editPhoto } from '../editor.js';
import { openCamera } from '../camera.js';
import { openMedia, onceButton, playAudio, openDoc, isPdf } from './viewer.js';
import { MAX_DOC_BYTES } from '../packages/protocol/src/documents.js';
import { validDocName } from '../packages/protocol/src/envelope.js';
import { prepareVideo } from '../video-prep.js';
import { startRecording, fmtDuration } from '../audio.js';
import { roomMenu } from './room-menu.js';
import { nativePickerAvailable, selectNativeAttachment, readNativeAttachment } from '../attachment-picker.js';
import { sensitiveScope } from '../sensitive-scope.js';
import { normalize } from '../packages/protocol/src/nickname.js';

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const EMOJIS = ['😀', '😂', '🥲', '😍', '😘', '😎', '🤔', '😴', '😢', '😡', '👍', '👎', '👏', '🙏', '💪', '❤️', '🔥', '✨', '🎉', '🌙', '☀️', '🌧️', '☕', '🍕'];

export async function chatScreen(go, { roomId, attachment = null }) {
  const S = session.S;
  const client = S.client;
  const scope = sensitiveScope({ transient: false, allowed: () => S.unlocked && S.client === client });
  let view = await session.roomView(roomId, true);
  if (!scope.valid()) { scope.cancel(); return; }
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
  scope.onCancel(() => videoJob?.abort());

  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    // Aparece na hora como "enviando…" (em rede lenta, como Tor, a ida e volta
    // demora); some ao confirmar ou volta para a caixa se falhar.
    const pending = h('li', { class: 'msg mine pending' }, h('span', { class: 'text', text }), h('span', { class: 'meta' }, h('span', { text: 'enviando…' })));
    log.querySelector('li.note')?.remove();
    log.append(pending);
    pending.scrollIntoView({ block: 'end' });
    try {
      await client.sendText(roomId, text, replyTo ? { replyTo } : {});
      pending.remove();
      clearTimeout(draftTimer);
      await session.setDraft(roomId, '');
      setReply(null);
      await render();
    } catch (e) { pending.remove(); input.value = text; toast(e.code === 'gone' ? 'Conversa encerrada.' : `Não enviou: ${errText(e)}`); }
  };
  const setReply = (m) => {
    replyTo = m?.msgId ?? null;
    replyBar.hidden = !m;
    replyBar.replaceChildren(...(m ? [h('span', { class: 'muted', text: `Respondendo: ${preview(m)}` }), h('button', { class: 'icon', 'aria-label': 'Cancelar resposta', text: '×', onclick: () => setReply(null) })] : []));
  };

  fileIn.onchange = async () => {
    const f = fileIn.files[0];
    fileIn.value = '';
    if (!f || !scope.valid()) return;
    const { video, once, doc } = pick;
    if (doc) return sendDoc(f);
    if (video) return sendVideo(f, once);
    try {
      const prepared = await preparePhoto(f); // recodificada, sem metadados
      await sendPhoto(prepared.bytes, prepared.mime, once);
    } catch (e) { toast(`Não enviou: ${errText(e)}`); }
  };

  // Foto (da câmera do app ou da galeria): editor → cifra → envia.
  async function sendPhoto(bytes, mime, once) {
    try {
      const p = await editPhoto(bytes, mime);
      if (!p) return; // cancelou no editor
      if (!scope.valid()) { p.bytes.fill(0); return; }
      const caption = takeCaption(once);
      await S.client.sendMedia(roomId, p.bytes, { mode: once ? 'once' : 'media', mime: p.mime, caption });
      p.bytes.fill(0);
      await render();
    } catch (e) { toast(`Não enviou: ${errText(e)}`); }
    finally { bytes.fill(0); }
  }

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
      if (!scope.valid()) return;
      label.textContent = 'Enviando cifrado…';
      bar.removeAttribute('value');
      await S.client.sendMedia(roomId, bytes, { mode: once ? 'once' : 'media', mime: 'video/mp4', duration, caption: takeCaption(once) });
      await render();
    } catch (e) { toast(`Não enviou: ${errText(e)}`); }
    finally { bytes?.fill(0); videoJob = null; progressBar.hidden = true; progressBar.replaceChildren(); }
  }

  // Documento (§16, P-12): lista positiva, texto UTF-8 ou PDF, os dois
  // mostrados dentro do app (nunca em outro app). O tipo é conferido pelo
  // conteúdo, não pelo nome. Três ativos por pessoa no app inteiro; o quarto
  // revoga o mais antigo para todos, então avisa antes.
  async function sendDoc(file) {
    let bytes = null;
    try {
      if (file.size > MAX_DOC_BYTES) throw new Error('documento acima de 20 MB.');
      bytes = new Uint8Array(await file.arrayBuffer());
      let mime = 'application/pdf';
      if (!isPdf(bytes)) {
        mime = 'text/plain;charset=utf-8';
        try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('só texto (UTF-8) ou PDF. Outros formatos não abrem com segurança dentro do app.'); }
        if (bytes.includes(0)) throw new Error('arquivo binário: só texto (UTF-8) ou PDF.');
      }
      const q = await S.client.api.get('/v1/docs/mine');
      if (q.active >= q.max && !await confirmSheet(`Você já tem ${q.max} documentos ativos no app. Enviar este apaga o mais antigo para todos, em qualquer conversa.`, 'Enviar mesmo assim')) return;
      let name = file.name.replace(/[\u0000-\u001f\u007f/\\]/g, '').trim().slice(0, 100);
      if (!validDocName(name)) name = mime === 'application/pdf' ? 'documento.pdf' : 'documento.txt';
      if (!scope.valid()) return;
      const m = await client.sendMedia(roomId, bytes, { mode: 'doc', mime, name });
      if (m.quota?.evicted?.length) toast('Documento enviado. O mais antigo foi apagado para todos (limite de 3).');
      await render();
    } catch (e) { toast(`Não enviou: ${errText(e)}`); }
    finally { bytes?.fill(0); }
  }

  // Câmera do app sempre; galeria só com o modo máximo desligado (Ajustes).
  const attach = async () => {
    const opts = [
      { label: 'Câmera: foto', value: 'cam-photo' }, { label: 'Câmera: foto de ver uma vez', value: 'cam-photo-once' },
      { label: 'Câmera: vídeo (até 5 min)', value: 'cam-video' }, { label: 'Câmera: vídeo de ver uma vez', value: 'cam-video-once' }];
    if (!session.maxMode()) opts.push(
      { label: 'Galeria: foto', value: 'photo' }, { label: 'Galeria: foto de ver uma vez', value: 'photo-once' },
      { label: 'Galeria: vídeo (até 5 min)', value: 'video' }, { label: 'Galeria: vídeo de ver uma vez', value: 'video-once' });
    opts.push({ label: 'Documento: texto ou PDF (até 20 MB)', value: 'doc' });
    const c = await choiceSheet(session.maxMode() ? 'Enviar (modo máximo: só pela câmera do app)' : 'Enviar', opts);
    if (!c) return;
    const once = c.endsWith('-once');
    if (c.startsWith('cam-')) {
      const video = c.startsWith('cam-video');
      const shot = await openCamera({ mode: video ? 'video' : 'photo' });
      if (!shot) return;
      return video ? sendVideo(shot.blob, once) : sendPhoto(shot.bytes, shot.mime, once);
    }
    pick = { video: c.startsWith('video'), once, doc: c === 'doc' };
    if (nativePickerAvailable()) {
      await session.setDraft(roomId, input.value);
      await session.lock('file-picker');
      await selectNativeAttachment(roomId, { ...pick });
      return;
    }
    fileIn.accept = pick.doc ? '.txt,.md,.csv,text/plain,.pdf,application/pdf' : pick.video ? 'video/*' : 'image/*';
    fileIn.click();
  };
  // Segurar grava; soltar desliga e permite confirmar, sem envio automático.
  const recBar = h('div', { class: 'rec-bar', hidden: true });
  let recording = null, recordPending = null, audioDraft = null;
  function discardAudio() {
    recordPending?.abort(); recordPending = null;
    recording?.cancel(); recording = null;
    audioDraft?.bytes.fill(0); audioDraft = null;
    recBar.replaceChildren(); recBar.hidden = true;
  }
  scope.onCancel(discardAudio);
  async function mic() {
    if (recording || recordPending || audioDraft || !scope.valid()) return;
    const ctl = new AbortController(); recordPending = ctl;
    const cancelParent = () => ctl.abort(); scope.signal.addEventListener('abort', cancelParent, { once: true });
    try {
      const timer = h('span', { class: 'code', text: '0:00' });
      const r = await startRecording({ signal: ctl.signal, onTick: (ms) => { timer.textContent = fmtDuration(ms); }, onLimit: () => finishRecording() });
      if (!scope.valid() || ctl.signal.aborted) { r.cancel(); return; }
      recording = r;
      recBar.replaceChildren(h('span', { class: 'rec-dot', 'aria-hidden': 'true' }), timer,
        h('button', { class: 'secondary small', text: 'Descartar', onclick: discardAudio }),
        h('button', { class: 'small', text: 'Parar gravação', onclick: finishRecording }));
      recBar.hidden = false;
    } catch (e) { if (scope.valid() && e.name !== 'AbortError') toast(e.name === 'NotAllowedError' ? 'Microfone negado.' : `Não deu para gravar: ${errText(e)}`); }
    finally { if (recordPending === ctl) recordPending = null; scope.signal.removeEventListener('abort', cancelParent); }
  }
  async function finishRecording() {
    if (recordPending && !recording) return discardAudio();
    const active = recording; recording = null;
    if (!active) return;
    const r = await active.stop();
    if (!r) { discardAudio(); return; }
    if (!scope.valid() || r.ms < 700) { r.bytes.fill(0); discardAudio(); return; }
    audioDraft = r;
    recBar.replaceChildren(h('span', { text: `Áudio · ${fmtDuration(r.ms)}` }),
      h('button', { class: 'secondary small', text: 'Descartar', onclick: discardAudio }),
      h('button', { class: 'small', text: 'Enviar áudio', onclick: async () => {
        if (!audioDraft || !scope.valid()) return;
        const draft = audioDraft; audioDraft = null; recBar.hidden = true;
        try { await client.sendMedia(roomId, draft.bytes, { mode: 'media', mime: draft.mime, duration: draft.ms }); if (scope.valid()) await render(); }
        catch (e) { if (scope.valid()) toast(`Não enviou: ${errText(e)}`); }
        finally { draft.bytes.fill(0); }
      } }));
  }
  const micButton = h('button', { class: 'icon', 'aria-label': 'Gravar áudio', text: '🎙',
    onpointerdown: (e) => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId); mic(); },
    onpointerup: (e) => { e.preventDefault(); finishRecording(); },
    onpointercancel: discardAudio,
    onclick: (e) => { if (e.detail === 0) { if (recording) finishRecording(); else mic(); } },
  });

  const emojiPanel = h('div', { class: 'emoji-panel', hidden: true }, EMOJIS.map((e) => h('button', { class: 'emoji', type: 'button', text: e, onclick: () => { input.value += e; input.focus(); } })));

  mount(h('div', { class: 'chat' },
    header(session.roomTitle(view), { back: () => go('chats'), actions: [h('button', { class: 'icon', 'aria-label': 'Menu da conversa', text: '⋮', onclick: async () => { const r = await roomMenu(go, roomId); if (r === 'search') { searchBar.hidden = false; searchIn.focus(); return; } if (r === 'refresh') return go('chat', { roomId }); } })] }),
    h('div', { class: 'policy muted small', text: policyLine(view) }),
    searchBar,
    log,
    view.closed ? h('p', { class: 'note center-text', text: 'Conversa encerrada. O que já existe continua só para leitura até vencer.' }) :
      h('footer', { class: 'composer' }, replyBar, recBar, progressBar, emojiPanel,
        h('div', { class: 'row' },
          h('button', { class: 'icon', 'aria-label': 'Anexar foto ou vídeo', text: '+', onclick: attach }),
          input,
          h('button', { class: 'icon', 'aria-label': 'Emojis', text: '☺', onclick: () => { emojiPanel.hidden = !emojiPanel.hidden; } }),
          micButton,
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
    const load = (options) => client.openMedia(m, options);
    const what = mediaName(m);
    if (m.body.mode === 'doc') {
      if (!m.body.key) return h('span', { class: 'media-tag', text: `Documento · ${m.body.name ?? ''}` });
      return h('button', { class: 'open media-tag', text: `Documento · ${m.body.name ?? 'sem nome'} · abrir`, onclick: () => openDoc(load, m.body.name, m.body.mime, { signal: scope.signal }).catch((e) => toast(`Não abriu: ${errText(e)}`)) });
    }
    if (m.body.mode === 'once') {
      const a = what === 'Foto' ? 'a' : 'o';
      if (mine) return h('span', { class: 'media-tag', text: `${what} de ver uma vez (enviad${a})` });
      if (m.consumed || !m.body.key) return h('span', { class: 'media-tag', text: `${what} de ver uma vez (abertura encerrada)` });
      // O núcleo do cliente já apaga a chave depois da tentativa; aqui só redesenha.
      return onceButton('Abrir uma vez', load, m.body.mime, async (err) => {
        if (!scope.valid()) return;
        if (err) toast('Não foi possível abrir. A visualização pode ter sido consumida; ela não será repetida automaticamente.');
        await render().catch(() => {});
      }, { signal: scope.signal });
    }
    if (/^audio\//.test(m.body.mime)) {
      const host = h('span', { class: 'audio-host' });
      return h('span', {}, h('button', { class: 'open media-tag', text: `Áudio · ${fmtDuration(m.body.duration ?? 0)} · tocar`, onclick: () => playAudio(load, m.body.mime, host, { signal: scope.signal }).catch((e) => toast(`Não tocou: ${errText(e)}`)) }), host);
    }
    const label = what === 'Vídeo' ? `Vídeo · ${fmtDuration(m.body.duration ?? 0)} · tocar para ver` : 'Foto · tocar para ver';
    return h('button', { class: 'open media-tag', text: label, onclick: () => openMedia(load, m.body.mime, { signal: scope.signal }).catch((e) => toast(`Não abriu: ${errText(e)}`)) });
  }

  const nodes = new Map();
  const unseen = new Set();
  let rendered = false, rendering = false, renderAgain = false;
  const down = h('button', { class: 'jump-bottom', hidden: true, 'aria-label': 'Ir para as mensagens novas', text: '↓', onclick: () => {
    log.scrollTop = log.scrollHeight; unseen.clear(); updateDown();
  } });
  log.after(down);
  const atBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  function updateDown() { if (atBottom()) unseen.clear(); down.hidden = atBottom(); down.textContent = unseen.size ? `↓ ${unseen.size}` : '↓'; }
  log.addEventListener('scroll', updateDown, { passive: true });
  async function render() {
    if (!scope.valid()) return;
    if (rendering) { renderAgain = true; return; }
    rendering = true;
    try {
      do {
        renderAgain = false;
        const r = await client.view(roomId);
        if (!scope.valid()) return;
        if (r.blocked) { log.replaceChildren(h('li', { class: 'note', text: 'Sem conexão confiável com o servidor: as mensagens ficam escondidas até reconectar.' })); nodes.clear(); return; }
        const bottom = !rendered || atBottom(), top = log.scrollTop;
        const byId = new Map(r.render.map((m) => [m.msgId, m]));
        const list = term ? r.render.filter((m) => normalize((m.kind === 'media' ? m.body?.caption ?? m.body?.name ?? '' : m.text) ?? '').includes(term)) : r.render;
        const wanted = new Set(list.map((m) => m.msgId));
        for (const [id, entry] of nodes) if (!wanted.has(id)) { entry.el.remove(); nodes.delete(id); unseen.delete(id); }
        for (const note of log.querySelectorAll('li.note')) note.remove();
        list.forEach((m, i) => {
          const signature = JSON.stringify([m.text, m.body?.caption, m.body?.key == null, m.consumed, m.edited, m.reactions, m.replyTo && [byId.has(m.replyTo), byId.get(m.replyTo)?.text]]);
          let entry = nodes.get(m.msgId);
          if (!entry || entry.signature !== signature) {
            const next = { el: bubble(m, byId), signature };
            if (entry) entry.el.replaceWith(next.el);
            else if (rendered && !bottom && m.sender !== client.userId) unseen.add(m.msgId);
            entry = next; nodes.set(m.msgId, entry);
          }
          if (log.children[i] !== entry.el) log.insertBefore(entry.el, log.children[i] ?? null);
        });
        if (!list.length) log.append(h('li', { class: 'note', text: term ? 'Nada encontrado no que ainda não venceu.' : 'Nenhuma mensagem.' }));
        rendered = true;
        log.scrollTop = bottom ? log.scrollHeight : top;
        updateDown();
      } while (renderAgain && scope.valid());
    } finally { rendering = false; }
  }

  // Fundo do grupo (cifrado, escolhido pela líder): imagem por CSSOM, sem
  // estilo em linha (CSP).
  const bg = view.kind === 'group' ? S.rooms[roomId]?.background : null;
  if (bg) session.visualURL(bg).then((url) => { if (url) { log.style.backgroundImage = `url("${url}")`; log.classList.add('has-bg'); } });

  await render();
  if (!scope.valid()) return;
  if (attachment && attachment.roomId === roomId) {
    (async () => {
      try {
        const f = await readNativeAttachment(attachment, { signal: scope.signal, allowed: scope.valid });
        if (!scope.valid()) return;
        if (attachment.pick.action?.startsWith('room-')) {
          const slot = attachment.pick.action === 'room-photo' ? 'photo' : 'background';
          const p = await preparePhoto(f, { maxSide: slot === 'photo' ? 512 : 1280, square: slot === 'photo' });
          try { if (scope.valid()) await session.setRoomVisual(roomId, slot, p.bytes); } finally { p.bytes.fill(0); }
          if (scope.valid()) go('chat', { roomId });
          return;
        }
        const { video, once, doc } = attachment.pick;
        if (doc) await sendDoc(f);
        else if (video) await sendVideo(f, once);
        else { const p = await preparePhoto(f); if (scope.valid()) await sendPhoto(p.bytes, p.mime, once); else p.bytes.fill(0); }
      } catch (e) { if (scope.valid()) toast(`Não abriu o anexo: ${errText(e)}`); }
    })();
  }
  const timer = setInterval(() => render().catch(() => {}), 30_000); // vencidas somem sozinhas
  const off = session.onChange((w) => { if (w === 'synced') render().catch(() => {}); });
  return () => { scope.cancel(); clearInterval(timer); off(); if (draftTimer) { clearTimeout(draftTimer); saveDraft(); } };
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
