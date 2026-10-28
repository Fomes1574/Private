// Conversa 1:1 ou grupo. Só horário (Brasília) em cada mensagem; nada de
// visto, entregue, online ou digitando (V6-022). Texto sempre como texto.
import { h, mount, header, toast, choiceSheet, iconSheet, confirmSheet, errText, onLongPress } from '../ui.js';
import * as session from '../session.js';
import { formatTime, formatDateTime } from '../packages/protocol/src/time.js';
import { preparePhoto } from '../media.js';
import { editPhoto } from '../editor.js';
import { openCamera } from '../camera.js';
import { openMedia, onceButton, playAudio, openDoc, isPdf, closeIfGone } from './viewer.js';
import { MAX_DOC_BYTES } from '../packages/protocol/src/documents.js';
import { validDocName } from '../packages/protocol/src/envelope.js';
import { prepareVideo } from '../video-prep.js';
import { startRecording, fmtDuration } from '../audio.js';
import { roomMenu } from './room-menu.js';
import { prepareBatch } from './batch.js';
import { pollSheet, pollBlock } from './poll.js';
import { verifySheet } from './verify.js';
import { warningText } from '../security-text.js';
import { nativePickerAvailable, pickInApp, readNativeAttachment, clearNativeAttachment } from '../attachment-picker.js';
import { sensitiveScope } from '../sensitive-scope.js';
import { normalize } from '../packages/protocol/src/nickname.js';
import { EDIT_WINDOW_MS } from '../packages/protocol/src/reconcile.js';
import { matchRank } from '../packages/protocol/src/search.js';
import { formatted } from '../format.js';
import { dayKey, dayLabel } from '../dates.js';

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const EMOJIS = ['😀', '😂', '🥲', '😍', '😘', '😎', '🤔', '😴', '😢', '😡', '👍', '👎', '👏', '🙏', '💪', '❤️', '🔥', '✨', '🎉', '🌙', '☀️', '🌧️', '☕', '🍕'];

export async function chatScreen(go, { roomId, attachment = null, replyFrom = null, find = null }) {
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
  // Seleção de várias mensagens (b.3): estado e barra criados antes da tela.
  let selecting = null;
  const selBar = h('div', { class: 'select-bar row', hidden: true });
  // Faixa de mensagens fixadas (b.11), criada antes da tela.
  let pinnedIds = new Set();
  const pinBar = h('div', { class: 'pin-bar', hidden: true });
  let videoJob = null;
  scope.onCancel(() => videoJob?.abort());

  // Responder em particular (b.15): a mensagem do grupo vai citada no começo.
  let privateQuote = replyFrom;
  const send = async () => {
    let text = input.value.trim();
    if (!text) return;
    if (privateQuote) { text = `> ${privateQuote.name}: ${privateQuote.text}\n${text}`.slice(0, 4000); privateQuote = null; replyBar.hidden = true; replyBar.replaceChildren(); }
    input.value = '';
    // O rascunho sai já no envio (a mensagem fica na fila durável); se falhar,
    // volta para a caixa e para o rascunho.
    clearTimeout(draftTimer);
    session.setDraft(roomId, '').catch(() => {});
    // Aparece na hora como "enviando…" (em rede lenta, como Tor, a ida e volta
    // demora); some ao confirmar ou volta para a caixa se falhar.
    const pending = h('li', { class: 'msg mine pending' }, h('span', { class: 'text', text }), h('span', { class: 'meta' }, h('span', { 'aria-label': 'enviando', text: '🕓' })));
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
    } catch (e) {
      pending.remove();
      // F10: sem rede, a mensagem já está na fila e vai sozinha; voltar o
      // texto para a caixa faria a pessoa mandar de novo (duplicada).
      if (e.code === 'pending' || e.code === 'send_failed') { clearTimeout(draftTimer); await session.setDraft(roomId, ''); setReply(null); toast('Sem conexão: a mensagem ficou na fila (🕓) e vai sozinha quando a rede voltar.'); await render(); return; }
      input.value = text; session.setDraft(roomId, text).catch(() => {}); toast(e.code === 'gone' ? 'Conversa encerrada.' : `Não enviou: ${errText(e)}`);
    }
  };
  const setReply = (m) => {
    replyTo = m?.msgId ?? null;
    replyBar.hidden = !m;
    replyBar.replaceChildren(...(m ? [h('span', { class: 'muted', text: `Respondendo: ${preview(m)}` }), h('button', { class: 'icon', 'aria-label': 'Cancelar resposta', text: '×', onclick: () => setReply(null) })] : []));
  };

  fileIn.onchange = async () => {
    const files = [...fileIn.files];
    const f = files[0];
    fileIn.value = '';
    if (!f || !scope.valid()) return;
    const { video, once, doc, hd, batch } = pick;
    if (batch) {
      // Galeria (D12): fotos juntas na tela de preparar; vídeos um a um.
      const chosen = files.slice(0, 5), videos = chosen.filter((x) => /^video\//.test(x.type));
      const prepared = [];
      for (const file of chosen) { if (videos.includes(file)) continue; try { const p = await preparePhoto(file, { maxSide: 4096, quality: 0.9 }); if (!scope.valid()) { p.bytes.fill(0); break; } prepared.push(p); } catch (e) { toast(errText(e)); } }
      if (files.length > 5) toast('Dá para mandar até 5 de uma vez. Os outros ficaram de fora.');
      if (!scope.valid()) { for (const p of prepared) p.bytes.fill(0); return; }
      if (prepared.length) await sendBatch(prepared);
      for (const v of videos) if (scope.valid()) await sendVideo(v, false);
      return;
    }
    if (hd) { try { const p = await preparePhoto(f, { maxSide: 4096, quality: 0.9 }); return sendPhoto(p.bytes, p.mime, false, { hd: true }); } catch (e) { return toast(`Não enviou: ${errText(e)}`); } }
    if (doc) return sendDoc(f);
    if (video) return sendVideo(f, once);
    try {
      const prepared = await preparePhoto(f); // recodificada, sem metadados
      await sendPhoto(prepared.bytes, prepared.mime, once);
    } catch (e) { sendFailed(e); }
  };

  // Foto (da câmera do app ou da galeria): editor → cifra → envia.
  async function sendPhoto(bytes, mime, once, { hd = false } = {}) {
    try {
      const p = await editPhoto(bytes, mime);
      if (!p) return; // cancelou no editor
      if (!scope.valid()) { p.bytes.fill(0); return; }
      const caption = takeCaption(once);
      await S.client.sendMedia(roomId, p.bytes, { mode: once ? 'once' : 'media', mime: p.mime, caption, ...(hd ? { hd: true } : {}) });
      p.bytes.fill(0);
      await render();
    } catch (e) { sendFailed(e); }
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
  async function sendVideo(file, once, { round = false } = {}) {
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
      const chosen = await choiceSheet('Preparar vídeo', [{ label: 'Enviar normalmente', value: 'media' }, { label: '① Ver uma vez', value: 'once' }]);
      if (!chosen || !scope.valid()) return;
      once = chosen === 'once';
      label.textContent = 'Enviando cifrado…';
      bar.removeAttribute('value');
      await S.client.sendMedia(roomId, bytes, { mode: once ? 'once' : 'media', mime: 'video/mp4', duration, caption: round ? undefined : takeCaption(once), ...(round ? { round: true } : {}) });
      await render();
    } catch (e) { sendFailed(e); }
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
    } catch (e) { sendFailed(e); }
    finally { bytes?.fill(0); }
  }

  // Câmera do app sempre; galeria só com o modo máximo desligado (Ajustes).
  const attach = async () => {
    const opts = [{ label: 'Câmera', icon: 'camera', value: 'camera' }];
    if (!session.maxMode()) opts.push({ label: 'Galeria', icon: 'gallery', value: 'gallery' });
    opts.push({ label: 'Documento', icon: 'document', value: 'doc' });
    const c = await iconSheet('Enviar', opts);
    if (!c || !scope.valid()) return;
    if (c === 'camera') {
      let mode = 'photo', round = false;
      for (;;) {
        const shot = await openCamera({ mode, round, allowModes: true, ...(round ? { maxMs: 60_000, facing: 'user' } : {}) });
        if (!shot || !scope.valid()) { shot?.bytes?.fill(0); return; }
        if (shot.switchMode) { round = shot.switchMode === 'round'; mode = shot.switchMode === 'photo' ? 'photo' : 'video'; continue; }
        return mode === 'video' ? sendVideo(shot.blob, false, { round }) : sendBatch([{ bytes: shot.bytes, mime: shot.mime }]);
      }
    }
    pick = { doc: c === 'doc', batch: c === 'gallery', media: c === 'gallery' };
    if (nativePickerAvailable()) {
      await session.setDraft(roomId, input.value);
      const got = await pickInApp(roomId, { ...pick }, scope.valid).catch((e) => { toast(`Não abriu a galeria: ${errText(e)}`); return null; });
      if (got && scope.valid()) await useAttachment(got);
      return;
    }
    fileIn.multiple = pick.batch;
    fileIn.accept = pick.doc ? '.txt,.md,.csv,text/plain,.pdf,application/pdf' : pick.media ? 'image/*,video/*' : pick.video ? 'video/*' : 'image/*';
    fileIn.click();
  };

  // Lote de até 5 fotos (D4): cada foto é uma mensagem própria, com chave,
  // prazo e ver uma vez próprios. Envio em ordem; o que cair sem rede fica na
  // fila e vai sozinho (F10), sem duplicar.
  async function sendBatch(prepared) {
    const initialCaption = input.value.trim().slice(0, 1000);
    const items = await prepareBatch(prepared, { initialCaption, allowGallery: !session.maxMode() && !nativePickerAvailable() });
    if (!items?.length || !scope.valid()) { for (const it of items ?? []) it.bytes.fill(0); return; }
    const label = h('span', { class: 'muted small' });
    progressBar.replaceChildren(label); progressBar.hidden = false;
    let sent = 0, queued = 0, failed = 0;
    const staged = [], ready = [];
    try {
      for (const [i, it] of items.entries()) {
        label.textContent = `Guardando ${i + 1} de ${items.length} cifrada…`;
        if (!scope.valid()) break;
        const p = await preparePhoto(new Blob([it.bytes], { type: it.mime }), { maxSide: it.hd ? 4096 : 1280, quality: it.hd ? 0.9 : 0.82 });
        if (!scope.valid()) { p.bytes.fill(0); break; }
        ready.push({ bytes: p.bytes, opts: { mode: it.once ? 'once' : 'media', mime: p.mime, caption: it.caption, hd: it.hd } });
        it.bytes.fill(0);
      }
      if (!scope.valid()) return;
      try { staged.push(...await client.prepareMediaBatch(roomId, ready)); }
      catch (e) { staged.push(...(e.preparedIds ?? [])); throw e; }
      if (staged.length && initialCaption) { input.value = ''; await session.setDraft(roomId, ''); }
      // Só começa a transmitir depois de todo o lote estar durável.
      for (const id of staged) {
        if (!scope.valid()) { queued++; continue; }
        try { await client.deliver(roomId, id); sent++; }
        catch (e) { if (e.code === 'pending') queued++; else { failed++; sendFailed(e); } }
      }
    } catch (e) { queued += staged.length; failed++; sendFailed(e); }
    finally { for (const it of [...items, ...ready]) it.bytes.fill(0); progressBar.hidden = true; progressBar.replaceChildren(); }

    if (queued || failed) toast(`${sent} enviada${sent === 1 ? '' : 's'}${queued ? `; ${queued} na fila (vão quando a rede voltar)` : ''}${failed ? `; ${failed} não foram` : ''}.`);
    if (scope.valid()) await render();
  }

  // Áudio como no WhatsApp (b.6): segurar o microfone grava; deslizar para a
  // esquerda cancela; deslizar para cima trava (grava sem segurar, com pausa).
  // Ao soltar, dá para ouvir antes de enviar. Nada é enviado sozinho, e sair
  // da tela ou trancar o app solta o microfone na hora (F12).
  const recBar = h('div', { class: 'rec-bar', hidden: true });
  let recording = null, recordPending = null, audioDraft = null, locked = false, audioPreview = null;
  function stopPreview() { if (audioPreview) { audioPreview.el.pause(); audioPreview.el.removeAttribute('src'); URL.revokeObjectURL(audioPreview.url); audioPreview = null; } }
  function discardAudio() {
    recordPending?.abort(); recordPending = null;
    recording?.cancel(); recording = null; locked = false;
    stopPreview();
    audioDraft?.bytes.fill(0); audioDraft = null;
    recBar.replaceChildren(); recBar.hidden = true;
  }
  scope.onCancel(discardAudio);
  const level = h('span', { class: 'rec-level', 'aria-hidden': 'true' });
  async function mic() {
    if (recording || recordPending || audioDraft || !scope.valid()) return;
    const ctl = new AbortController(); recordPending = ctl;
    const cancelParent = () => ctl.abort(); scope.signal.addEventListener('abort', cancelParent, { once: true });
    try {
      const timer = h('span', { class: 'code', text: '0:00' });
      const r = await startRecording({ signal: ctl.signal, onTick: (ms) => { timer.textContent = fmtDuration(ms); }, onLevel: (v) => { level.style.setProperty('--lvl', String(Math.min(1, v * 2))); }, onLimit: () => finishRecording() });
      if (!scope.valid() || ctl.signal.aborted) { r.cancel(); return; }
      recording = r;
      recBar.replaceChildren(h('span', { class: 'rec-dot', 'aria-hidden': 'true' }), timer, level,
        h('span', { class: 'muted small rec-hint', text: '◀ deslize para cancelar · ▲ trave' }),
        h('button', { class: 'secondary small', text: 'Descartar', onclick: discardAudio }),
        h('button', { class: 'small', text: 'Parar gravação', onclick: finishRecording }));
      recBar.hidden = false;
    } catch (e) { if (scope.valid() && e.name !== 'AbortError') toast(e.name === 'NotAllowedError' ? 'Microfone negado.' : `Não deu para gravar: ${errText(e)}`); }
    finally { if (recordPending === ctl) recordPending = null; scope.signal.removeEventListener('abort', cancelParent); }
  }
  function lockRecording() {
    if (!recording || locked) return;
    locked = true;
    const pauseBtn = h('button', { class: 'secondary small', text: 'Pausar', onclick: () => {
      if (!recording) return;
      if (recording.paused()) { recording.resume(); pauseBtn.textContent = 'Pausar'; } else { recording.pause(); pauseBtn.textContent = 'Continuar'; }
    } });
    recBar.querySelector('.rec-hint')?.replaceWith(h('span', { class: 'muted small', text: '🔒 travado' }));
    recBar.append(pauseBtn);
  }
  async function finishRecording() {
    if (recordPending && !recording) return discardAudio();
    const active = recording; recording = null; locked = false;
    if (!active) return;
    const r = await active.stop();
    if (!r) { discardAudio(); return; }
    if (!scope.valid() || r.ms < 700) { r.bytes.fill(0); discardAudio(); return; }
    audioDraft = r;
    // Áudio de ver uma vez (b.7), como no WhatsApp: o "1" antes de enviar.
    let onceAudio = false;
    const onceBtn = h('button', { class: 'once-toggle', type: 'button', 'aria-pressed': 'false', 'aria-label': 'Ver uma vez desligado', text: '1', onclick: () => {
      onceAudio = !onceAudio;
      onceBtn.classList.toggle('on', onceAudio);
      onceBtn.setAttribute('aria-pressed', String(onceAudio));
      onceBtn.setAttribute('aria-label', onceAudio ? 'Visualização única ativada' : 'Ver uma vez desligado');
    } });
    recBar.replaceChildren(h('span', { text: `Áudio · ${fmtDuration(r.ms)}` }), onceBtn,
      h('button', { class: 'secondary small', text: 'Ouvir', onclick: () => {
        if (!audioDraft) return;
        if (audioPreview) return stopPreview();
        const url = URL.createObjectURL(new Blob([audioDraft.bytes], { type: audioDraft.mime }));
        const el = new Audio(url); audioPreview = { el, url };
        el.onended = stopPreview; el.play().catch(stopPreview);
      } }),
      h('button', { class: 'secondary small', text: 'Descartar', onclick: discardAudio }),
      h('button', { class: 'small', text: 'Enviar áudio', onclick: async () => {
        if (!audioDraft || !scope.valid()) return;
        stopPreview();
        const draft = audioDraft; audioDraft = null; recBar.hidden = true;
        try { await client.sendMedia(roomId, draft.bytes, { mode: onceAudio ? 'once' : 'media', mime: draft.mime, duration: draft.ms }); if (scope.valid()) await render(); }
        catch (e) { if (scope.valid()) sendFailed(e); }
        finally { draft.bytes.fill(0); }
      } }));
  }
  let micStart = null;
  const micButton = h('button', { class: 'icon', 'aria-label': 'Gravar áudio', text: '🎙',
    onpointerdown: (e) => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId); micStart = { x: e.clientX, y: e.clientY }; mic(); },
    onpointermove: (e) => {
      if (!micStart) return;
      if (e.clientX - micStart.x < -80) { micStart = null; discardAudio(); toast('Áudio cancelado.'); }
      else if (e.clientY - micStart.y < -60) { micStart = null; lockRecording(); }
    },
    onpointerup: (e) => { e.preventDefault(); const was = micStart; micStart = null; if (was && !locked) finishRecording(); },
    onpointercancel: () => { if (!locked) discardAudio(); micStart = null; },
    onclick: (e) => { if (e.detail === 0) { if (recording) finishRecording(); else mic(); } },
  });

  const emojiPanel = h('div', { class: 'emoji-panel', hidden: true }, EMOJIS.map((e) => h('button', { class: 'emoji', type: 'button', text: e, onclick: () => { input.value += e; input.focus(); } })));

  mount(h('div', { class: 'chat' },
    header(session.roomTitle(view), { back: () => go('chats'), actions: [h('button', { class: 'icon', 'aria-label': 'Menu da conversa', text: '⋮', onclick: async () => { const r = await roomMenu(go, roomId); if (r === 'search') { searchBar.hidden = false; searchIn.focus(); return; } if (r === 'poll') { const q = await pollSheet(); if (q && scope.valid()) { try { await client.sendPoll(roomId, q.question, q.options, q.multi); await render(); } catch (e) { sendFailed(e); } } return; } if (r === 'refresh') return go('chat', { roomId }); } })] }),
    h('div', { class: 'policy muted small', text: policyLine(view) }),
    searchBar, selBar, pinBar,
    log,
    view.closed || !session.imActive(view) ? h('p', { class: 'note center-text', text: view.closed ? 'Conversa encerrada. O que já existe continua só para leitura até vencer.' : 'Você saiu deste grupo. O que já existe continua só para leitura até vencer.' }) :
      h('footer', { class: 'composer' }, replyBar, recBar, progressBar, emojiPanel,
        h('div', { class: 'row' },
          h('button', { class: 'icon', 'aria-label': 'Anexar foto ou vídeo', text: '+', onclick: attach }),
          input,
          h('button', { class: 'icon', 'aria-label': 'Emojis', text: '☺', onclick: () => { emojiPanel.hidden = !emojiPanel.hidden; } }),
          micButton,
          h('button', { class: 'send', 'aria-label': 'Enviar', text: '➤', onclick: send })),
        fileIn)));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  if (privateQuote) {
    replyBar.hidden = false;
    replyBar.replaceChildren(h('span', { class: 'muted', text: `Respondendo em particular: ${privateQuote.name}: ${privateQuote.text}` }),
      h('button', { class: 'icon', 'aria-label': 'Cancelar resposta', text: '×', onclick: () => { privateQuote = null; replyBar.hidden = true; replyBar.replaceChildren(); } }));
  }
  // @menção no grupo (b.10): sugestões dos membros enquanto digita.
  const mentionBox = h('div', { class: 'mention-box', hidden: true });
  input.before?.(mentionBox);
  input.addEventListener('input', () => {
    const upTo = input.value.slice(0, input.selectionStart ?? input.value.length);
    const m = view.kind === 'group' ? /(?:^|\s)@([\p{L}\p{N}_.\- ]{0,24})$/u.exec(upTo) : null;
    if (!m) { mentionBox.hidden = true; return; }
    const names = view.members.filter((x) => x.active && x.userId !== client.userId).map((x) => session.nameOf(x.userId));
    const found = names.filter((n) => !m[1] || matchRank(n, m[1]) >= 0).slice(0, 6);
    mentionBox.hidden = !found.length;
    mentionBox.replaceChildren(...found.map((n) => h('button', { class: 'secondary small', type: 'button', text: `@${n}`, onclick: () => {
      const start = upTo.length - m[1].length - 1;
      input.value = `${input.value.slice(0, start)}@${n} ${input.value.slice(upTo.length)}`;
      mentionBox.hidden = true; input.focus();
    } })));
  });
  // Rascunho: volta ao reabrir a conversa (cifrado no aparelho).
  let draftTimer = null, editing = false;
  const draft = await session.getDraft(roomId);
  if (!input.value) input.value = draft;
  const saveDraft = () => { if (!editing) session.setDraft(roomId, input.value.trim() ? input.value : '').catch(() => {}); };
  input.addEventListener('input', () => { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 500); });

  // Segurar a mensagem (b.1), como no WhatsApp: reações em cima e o menu.
  async function actions(m) {
    if (selecting) return toggleSelect(m);
    const mine = m.sender === S.client.userId;
    const canReact = !(m.kind === 'media' && m.body?.mode === 'once');
    const opts = [{ label: 'Responder', value: 'reply' }];
    if (view.kind === 'group' && !mine) opts.push({ label: 'Responder em particular', value: 'private' });
    if (mine && m.kind === 'text' && (S.clock.now() ?? Date.now()) - m.acceptedAt < EDIT_WINDOW_MS) opts.push({ label: 'Editar', value: 'edit' });
    if (extraActions) for (const o of extraActions(m)) opts.push(o);
    opts.push({ label: 'Selecionar', value: 'select' });
    opts.push({ label: 'Apagar', value: 'delete', danger: true });
    const c = await messageSheet(`Some em ${formatDateTime(m.expiresAt)} (horário de Brasília)`, canReact ? REACTIONS : [], opts);
    try {
      if (!c) return;
      if (c.react) { await S.client.react(roomId, m.msgId, c.react); return render(); }
      const v = c.value;
      if (v === 'reply') { setReply(m); input.focus(); }
      if (v === 'private') { const d = await session.startDirect(m.sender); return go('chat', { roomId: d.roomId, replyFrom: { text: preview(m), name: session.nameOf(m.sender) } }); }
      if (v === 'select') return toggleSelect(m);
      if (v === 'edit') {
        editing = true;
        input.value = m.text;
        input.focus();
        const done = async () => { editing = false; const t = input.value.trim(); input.value = ''; if (t && t !== m.text) await S.client.edit(roomId, m.msgId, t); await render(); };
        input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); input.onkeydown = null; done(); } };
        toast('Edite e aperte Enter. A mensagem fica com "editada" e o mesmo prazo.');
      }
      if (v === 'delete') await deleteMessages([m]);
      if (extraHandle) await extraHandle(v, m);
      await render();
    } catch (e) { toast(`Não deu: ${errText(e)}`); }
  }
  // Pontos de extensão para funções da entrega C (fixar, favoritar…).
  let extraActions = (m) => {
    const out = [];
    if (session.imActive(view) && !view.closed && !(m.kind === 'media' && m.body?.mode === 'once')) out.push({ label: pinnedIds.has(m.msgId) ? 'Desafixar' : 'Fixar', value: 'pin' });
    out.push({ label: m.starred ? 'Desfavoritar' : 'Favoritar', value: 'star' });
    return out;
  };
  let extraHandle = async (v, m) => {
    if (v === 'star') { await client.star(m.msgId, !m.starred); toast(m.starred ? 'Tirada das favoritas.' : 'Favoritada (só neste aparelho; some quando a mensagem vencer).'); }
    if (v === 'pin') {
      if (pinnedIds.has(m.msgId)) { await client.pin(roomId, m.msgId, 0); toast('Desafixada.'); return; }
      const H = 3600_000;
      const d = await choiceSheet('Fixar por quanto tempo? Nunca passa do prazo da mensagem.', [{ label: '24 horas', value: 24 * H }, { label: '7 dias', value: 168 * H }, { label: '30 dias', value: 720 * H }]);
      if (!d) return;
      await client.pin(roomId, m.msgId, (S.clock.now() ?? Date.now()) + d);
      toast('Fixada para todos na conversa.');
    }
  };
  // Fixadas: faixa no topo, como no WhatsApp; tocar leva à mensagem.
  async function drawPins() {
    const pins = await client.pinsOf(roomId);
    pinnedIds = new Set(pins.map((p) => p.target));
    pinBar.hidden = !pins.length;
    if (!pins.length) return pinBar.replaceChildren();
    const last = pins.at(-1);
    pinBar.replaceChildren(h('button', { class: 'row-btn small', onclick: () => { const t = nodes.get(last.target)?.el; if (t) { t.scrollIntoView({ block: 'center' }); t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 1200); } } },
      h('span', { text: `📌 ${pins.length > 1 ? `${pins.length} fixadas · ` : ''}${preview(last.message)}` })));
  }
  // Apagar como no WhatsApp: "para todos" só se todas forem suas.
  async function deleteMessages(list) {
    const allMine = list.every((m) => m.sender === S.client.userId);
    const n = list.length;
    const opts = [{ label: 'Apagar para mim', value: 'me', danger: true }];
    if (allMine) opts.unshift({ label: 'Apagar para todos', value: 'all', danger: true });
    const c = await choiceSheet(n > 1 ? `Apagar ${n} mensagens?` : 'Apagar mensagem?', opts);
    if (c === 'me') { await S.client.deleteManyForMe(list.map((m) => m.msgId)); toast(n > 1 ? 'Apagadas para você.' : 'Apagada para você.'); }
    if (c === 'all') {
      for (const m of list) await S.client.deleteForAll(roomId, m.msgId, { mediaId: m.kind === 'media' ? m.body?.mediaId : null });
      toast('Apagada para todos. Some dos aparelhos assim que eles se conectarem.');
    }
  }

  // Selecionar várias (b.3).
  function updateSelBar() {
    if (!selecting?.size) { selecting = null; selBar.hidden = true; for (const { el } of nodes.values()) el.classList.remove('selected'); return; }
    selBar.hidden = false;
    selBar.replaceChildren(h('span', { class: 'grow', text: `${selecting.size} selecionada${selecting.size > 1 ? 's' : ''}` }),
      h('button', { class: 'secondary small', text: 'Cancelar', onclick: () => { selecting = null; updateSelBar(); } }),
      h('button', { class: 'danger small', text: 'Apagar', onclick: async () => {
        const list = [...selecting.values()];
        try { await deleteMessages(list); } catch (e) { toast(`Não deu: ${errText(e)}`); }
        selecting = null; updateSelBar(); await render();
      } }));
  }
  function toggleSelect(m) {
    selecting ??= new Map();
    if (selecting.has(m.msgId)) selecting.delete(m.msgId); else selecting.set(m.msgId, m);
    nodes.get(m.msgId)?.el.classList.toggle('selected', selecting.has(m.msgId));
    updateSelBar();
  }

  // Deslizar a mensagem para a direita responde (b.2).
  function swipeToReply(el, m) {
    let x0 = null, y0 = 0;
    el.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') { x0 = e.clientX; y0 = e.clientY; } });
    el.addEventListener('pointermove', (e) => {
      if (x0 === null) return;
      const dx = e.clientX - x0, dy = Math.abs(e.clientY - y0);
      if (dy > 30) { x0 = null; el.style.transform = ''; return; }
      if (dx > 0) el.style.transform = `translateX(${Math.min(dx, 80)}px)`;
      if (dx > 70) { x0 = null; el.style.transform = ''; setReply(m); input.focus(); }
    });
    for (const ev of ['pointerup', 'pointercancel']) el.addEventListener(ev, () => { x0 = null; el.style.transform = ''; });
  }

  const memberNames = () => view.kind === 'group' ? view.members.filter((x) => x.active).map((x) => session.nameOf(x.userId)) : [];
  function bubble(m, byId) {
    // Aviso de segurança dentro da conversa (S1), como no WhatsApp.
    if (m.sys) return h('li', { class: 'msg-sys', role: 'button', onclick: () => verifySheet(m.sys.userId) }, `🔒 ${warningText(m.sys)}`);
    if (m.sep) return h('li', { class: 'day-sep' }, h('span', { text: m.sep }));
    if (m.unreadDivider) return h('li', { class: 'unread-sep' }, h('span', { text: `${m.unreadDivider} ${m.unreadDivider > 1 ? 'mensagens não lidas' : 'mensagem não lida'}` }));
    const mine = m.sender === S.client.userId;
    const parts = [];
    if (view.kind !== 'direct' && !mine) parts.push(h('span', { class: 'who', text: session.nameOf(m.sender) }));
    if (m.replyTo) {
      const orig = byId.get(m.replyTo);
      // Tocar na citação leva à mensagem original.
      parts.push(h('span', { class: 'quote', role: orig ? 'button' : null, text: orig ? preview(orig) : 'Mensagem que não existe mais',
        onclick: orig ? (e) => { e.stopPropagation(); const t = nodes.get(m.replyTo)?.el; if (t) { t.scrollIntoView({ block: 'center' }); t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 1200); } } : null }));
    }
    if (m.kind === 'media') {
      parts.push(mediaBlock(m, mine));
      if (m.body?.caption) parts.push(h('span', { class: 'text caption' }, ...formatted(m.body.caption, { mentions: memberNames() })));
    } else if (extraBody?.(m)) parts.push(extraBody(m));
    else parts.push(h('span', { class: 'text' }, ...formatted(m.text, { mentions: memberNames() })));
    const meta = [];
    if (extraMeta) meta.push(...extraMeta(m));
    if (m.edited) meta.push(h('span', { text: 'editada' }));
    meta.push(h('time', { text: formatTime(m.acceptedAt) }));
    // ✓ = o servidor recebeu (b.8). Sem ✓✓ de entregue nem de lida (V6-022).
    if (mine) meta.push(h('span', { class: 'tick', 'aria-label': 'enviada', text: '✓' }));
    const reacts = Object.values(m.reactions ?? {});
    if (reacts.length) meta.push(h('span', { class: 'reacts', text: reacts.join('') }));
    parts.push(h('span', { class: 'meta' }, meta));
    const li = h('li', { class: mine ? 'msg mine' : 'msg', onclick: (e) => { if (selecting && !e.target.closest('.open, .once-open, .audio-box')) toggleSelect(m); } }, parts);
    if (selecting?.has(m.msgId)) li.classList.add('selected');
    onLongPress(li, (e) => { if (!e.target?.closest?.('.once-open, .audio-box')) actions(m); });
    swipeToReply(li, m);
    return li;
  }
  // Enquete (D), fixar (b.11) e favoritas (b.12).
  let extraBody = (m) => m.kind === 'poll' ? pollBlock(m, { me: client.userId, onVote: async (choices) => {
    if (!session.imActive(view) || view.closed) return toast('Você não está mais nesta conversa.');
    try { await client.vote(roomId, m.msgId, choices); await render(); } catch (e) { toast(`Não votou: ${errText(e)}`); }
  } }) : null;
  let extraMeta = (m) => (m.starred ? [h('span', { 'aria-label': 'favorita', text: '⭐' })] : []);

  // Visualizador ligado à mensagem: fecha quando ela vence ou some (F07).
  const viewOpts = (m) => ({ signal: scope.signal, msgId: m.msgId, expiresIn: m.expiresAt - (S.clock.now() ?? Date.now()) });
  function mediaBlock(m, mine) {
    const load = (options) => client.openMedia(m, options);
    const what = mediaName(m);
    if (m.body.mode === 'doc') {
      if (!m.body.key) return h('span', { class: 'media-tag', text: `Documento · ${m.body.name ?? ''}` });
      return h('button', { class: 'open media-tag', text: `Documento · ${m.body.name ?? 'sem nome'} · abrir`, onclick: () => openDoc(load, m.body.name, m.body.mime, viewOpts(m)).catch((e) => toast(`Não abriu: ${errText(e)}`)) });
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
      }, viewOpts(m));
    }
    if (/^audio\//.test(m.body.mime)) {
      const host = h('span', { class: 'audio-host' });
      return h('span', {}, h('button', { class: 'open media-tag', text: `Áudio · ${fmtDuration(m.body.duration ?? 0)} · tocar`, onclick: () => playAudio(load, m.body.mime, host, viewOpts(m)).catch((e) => toast(`Não tocou: ${errText(e)}`)) }), host);
    }
    const label = what === 'Vídeo' ? `${m.body.round ? 'Vídeo redondo' : 'Vídeo'} · ${fmtDuration(m.body.duration ?? 0)} · tocar para ver` : `${m.body.hd ? 'Foto HD' : 'Foto'} · tocar para ver`;
    return h('button', { class: m.body.round ? 'open media-tag round-tag' : 'open media-tag', text: label, onclick: () => openMedia(load, m.body.mime, { ...viewOpts(m), round: !!m.body.round }).catch((e) => toast(`Não abriu: ${errText(e)}`)) });
  }

  const nodes = new Map();
  const unseen = new Set();
  let rendered = false, rendering = false, renderAgain = false;
  const down = h('button', { class: 'jump-bottom', hidden: true, 'aria-label': 'Ir para as mensagens novas', text: '↓', onclick: () => {
    log.scrollTop = log.scrollHeight; unseen.clear(); updateDown();
  } });
  log.after(down);
  const atBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  // Lida só quando aparece na tela: quem lê lá em cima não zera (D2).
  let lastAt = 0;
  const openReadAt = S.rooms[roomId]?.readAt ?? 0;
  function updateDown() {
    if (atBottom()) { unseen.clear(); if (lastAt && scope.valid() && !document.hidden) session.markRead(roomId, lastAt).catch(() => {}); }
    down.hidden = atBottom(); down.textContent = unseen.size ? `↓ ${unseen.size}` : '↓';
  }
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
        let list = term ? r.render.filter((m) => normalize((m.kind === 'media' ? m.body?.caption ?? m.body?.name ?? '' : m.text) ?? '').includes(term)) : r.render;
        const realCount = list.length;
        if (!term) {
          const notes = session.roomWarnings(view).map((w) => ({ msgId: `w:${w.userId}:${w.at}`, sys: w, acceptedAt: w.at }));
          if (notes.length) list = [...list, ...notes].sort((a, b) => a.acceptedAt - b.acceptedAt);
          // Separadores de dia (b.4) e a faixa de não lidas de quando abriu.
          const withSeps = [];
          let lastDay = null, divided = false;
          const unreadIdx = list.findIndex((m) => !m.sys && m.sender !== client.userId && m.acceptedAt > openReadAt);
          const unreadN = unreadIdx < 0 ? 0 : list.slice(unreadIdx).filter((m) => !m.sys && m.sender !== client.userId).length;
          list.forEach((m, i) => {
            const k = dayKey(m.acceptedAt);
            if (k !== lastDay) { withSeps.push({ msgId: `d:${k}`, sep: dayLabel(m.acceptedAt, S.clock.now() ?? Date.now()), acceptedAt: m.acceptedAt }); lastDay = k; }
            if (i === unreadIdx && unreadN && !divided) { withSeps.push({ msgId: 'unread', unreadDivider: unreadN, acceptedAt: m.acceptedAt }); divided = true; }
            withSeps.push(m);
          });
          list = withSeps;
        }
        const wanted = new Set(list.map((m) => m.msgId));
        for (const [id, entry] of nodes) if (!wanted.has(id)) { entry.el.remove(); nodes.delete(id); unseen.delete(id); }
        if (!term) closeIfGone((id) => byId.has(id));
        for (const note of log.querySelectorAll('li.note')) note.remove();
        list.forEach((m, i) => {
          const signature = m.sys ? 'sys' : m.sep ? `sep:${m.sep}` : m.unreadDivider ? `u:${m.unreadDivider}` : JSON.stringify([m.votes, m.starred, m.text, m.body?.caption, m.body?.key == null, m.consumed, m.edited, m.reactions, m.replyTo && [byId.has(m.replyTo), byId.get(m.replyTo)?.text]]);
          let entry = nodes.get(m.msgId);
          if (!entry || entry.signature !== signature) {
            const next = { el: bubble(m, byId), signature };
            if (entry) entry.el.replaceWith(next.el);
            else if (rendered && !bottom && !m.sys && !m.sep && !m.unreadDivider && m.sender !== client.userId) unseen.add(m.msgId);
            entry = next; nodes.set(m.msgId, entry);
          }
          if (log.children[i] !== entry.el) log.insertBefore(entry.el, log.children[i] ?? null);
        });
        // Na fila (F10): aparecem com 🕓 até o servidor aceitar.
        for (const el of log.querySelectorAll('li.queued')) el.remove();
        const queued = term ? [] : (await client.outbox()).filter((o) => o.roomId === roomId && o.local);
        for (const o of queued) {
          const failed = o.state === 'failed' || o.state === 'staging';
          const el = h('li', { class: 'msg mine pending queued' }, h('span', { class: 'text', text: o.local.kind === 'media' ? mediaName(o.local) : o.local.body?.text ?? '' }),
            h('span', { class: 'meta', 'aria-label': failed ? 'falhou' : 'na fila', text: failed ? 'Falhou' : '🕓' }),
            h('button', { class: 'secondary small', text: 'Remover da fila', onclick: async () => { await client.cancelQueued(o.payload.msgId); if (scope.valid()) await render(); } }));
          if (failed && o.state !== 'staging') el.append(h('button', { class: 'secondary small', text: 'Tentar novamente', onclick: async () => { try { await client.retryQueued(o.payload.msgId); } catch (e) { sendFailed(e); } if (scope.valid()) await render(); } }));
          log.append(el);
        }

        if (!realCount && !queued.length) log.append(h('li', { class: 'note', text: term ? 'Nada encontrado no que ainda não venceu.' : 'Nenhuma mensagem.' }));
        // Primeira vez: abre na faixa de não lidas, como no WhatsApp.
        const firstOpen = !rendered;
        rendered = true;
        const divider = firstOpen ? nodes.get('unread')?.el : null;
        if (divider) divider.scrollIntoView({ block: 'start' });
        else log.scrollTop = bottom ? log.scrollHeight : top;
        lastAt = r.render.at(-1)?.acceptedAt ?? 0;
        drawPins().catch(() => {});
        updateDown();
      } while (renderAgain && scope.valid());
    } finally { rendering = false; }
  }

  // Fundo do grupo (cifrado, escolhido pela líder): imagem por CSSOM, sem
  // estilo em linha (CSP).
  const bg = view.kind === 'group' ? S.rooms[roomId]?.background : null;
  if (bg) session.visualURL(bg).then((url) => { if (url) { log.style.backgroundImage = `url("${url}")`; log.classList.add('has-bg'); } });
  // Papel de parede só deste aparelho na conversa individual (b.17).
  else if (view.kind === 'direct') session.wallpaperURL(roomId).then((url) => {
    if (!url) return;
    if (!scope.valid()) return URL.revokeObjectURL(url);
    log.style.backgroundImage = `url("${url}")`; log.classList.add('has-bg');
    scope.onCancel(() => URL.revokeObjectURL(url));
  });

  // Veio da busca geral (b.14): abre já filtrando por esse trecho.
  if (find) { searchBar.hidden = false; searchIn.value = find; term = normalize(find.trim()); }
  await render();
  if (!scope.valid()) return;
  // Anexo escolhido no seletor nativo: na volta rápida (D13) ou depois do PIN.
  async function useAttachment(attachment) {
    const opts = (index = 0, keep = false) => ({ signal: scope.signal, allowed: scope.valid, index, keep });
    try {
      if (attachment.pick.batch) return await useGallery(attachment);
      const f = await readNativeAttachment(attachment, opts());
      if (!scope.valid()) return;
      if (attachment.pick.action === 'wallpaper') {
        const p = await preparePhoto(f, { maxSide: 1280 });
        try { if (scope.valid()) await session.setWallpaper(roomId, p.bytes); } finally { p.bytes.fill(0); }
        if (scope.valid()) go('chat', { roomId });
        return;
      }
      if (attachment.pick.action?.startsWith('room-')) {
        const slot = attachment.pick.action === 'room-photo' ? 'photo' : 'background';
        const p = await preparePhoto(f, { maxSide: slot === 'photo' ? 512 : 1280, square: slot === 'photo' });
        try { if (scope.valid()) await session.setRoomVisual(roomId, slot, p.bytes); } finally { p.bytes.fill(0); }
        if (scope.valid()) go('chat', { roomId });
        return;
      }
      const { video, once, doc, hd } = attachment.pick;
      if (hd) { const p = await preparePhoto(f, { maxSide: 4096, quality: 0.9 }); if (scope.valid()) await sendPhoto(p.bytes, p.mime, false, { hd: true }); else p.bytes.fill(0); return; }
      if (doc) await sendDoc(f);
      else if (video) await sendVideo(f, once);
      else { const p = await preparePhoto(f); if (scope.valid()) await sendPhoto(p.bytes, p.mime, once); else p.bytes.fill(0); }
    } catch (e) { if (scope.valid()) toast(`Não abriu o anexo: ${errText(e)}`); }

    // Galeria (D12): sempre como foto ou vídeo, nunca como documento. Lê tudo
    // antes (a seleção nativa vence em 5 min); as fotos vão juntas para a tela
    // de preparar e os vídeos, um a um, com a escolha de normal ou ver uma vez.
    async function useGallery(sel) {
      const prepared = [], videos = [];
      try {
        for (let i = 0; i < (sel.count ?? 1) && scope.valid(); i++) {
          const file = await readNativeAttachment(sel, opts(i, true));
          if (/^video\//.test(file.type)) { videos.push(file); continue; }
          try {
            const p = await preparePhoto(file, { maxSide: 4096, quality: 0.9 });
            if (!scope.valid()) { p.bytes.fill(0); break; }
            prepared.push(p);
          } catch (e) { toast(errText(e)); }
        }
      } finally { await clearNativeAttachment(sel); }
      try {
        if (sel.dropped) toast('Dá para mandar até 5 de uma vez. Os outros ficaram de fora.');
        if (prepared.length && scope.valid()) await sendBatch(prepared);
        for (const v of videos) if (scope.valid()) await sendVideo(v, false);
      } finally { for (const p of prepared) p.bytes.fill(0); }
    }
  }
  if (attachment && attachment.roomId === roomId) useAttachment(attachment);
  const timer = setInterval(() => render().catch(() => {}), 30_000); // vencidas somem sozinhas
  // F18: membros, liderança e encerramento também mudam pela sincronização.
  const refreshView = async () => {
    const v = await session.roomView(roomId, true);
    if (!v || !scope.valid()) return;
    if (v.closed !== view.closed || v.leader !== view.leader) return go('chat', { roomId });
    view = v;
  };
  const off = session.onChange((w) => { if (w === 'synced') { render().catch(() => {}); refreshView().catch(() => {}); } if (w === 'verified') render().catch(() => {}); });
  return () => { scope.cancel(); clearInterval(timer); off(); if (draftTimer) { clearTimeout(draftTimer); saveDraft(); } };
}

// Menu da mensagem como no WhatsApp: barra de reações + opções.
function messageSheet(title, reactions, options) {
  return new Promise((resolve) => {
    const close = (v) => { sheet.remove(); resolve(v); };
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', onclick: (e) => { if (e.target === sheet) close(null); } },
      h('div', { class: 'sheet-box' },
        reactions.length ? h('div', { class: 'react-bar row', role: 'group', 'aria-label': 'Reagir' }, reactions.map((r) => h('button', { class: 'emoji', 'aria-label': `Reagir com ${r}`, text: r, onclick: () => close({ react: r }) }))) : null,
        h('p', { class: 'muted small', text: title }),
        options.map((o) => h('button', { class: o.danger ? 'danger block' : 'secondary block', text: o.label, onclick: () => close({ value: o.value }) })),
        h('button', { class: 'block', text: 'Fechar', onclick: () => close(null) })));
    document.body.append(sheet);
  });
}

// Mídia pausada porque a chave de alguém conferido mudou (S1): abre a
// verificação dessa pessoa.
function sendFailed(e) {
  if (e?.code === 'key_unverified') { toast(errText(e)); if (e.userIds?.[0]) verifySheet(e.userIds[0]); return; }
  if (e?.code === 'pending') { toast('Sem conexão: ficou na fila (🕓) e vai sozinha quando a rede voltar.'); return; }
  toast(`Não enviou: ${errText(e)}`);
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
