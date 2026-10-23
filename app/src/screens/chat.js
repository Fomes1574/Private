// Conversa 1:1 ou grupo. Só horário (Brasília) em cada mensagem; nada de
// visto, entregue, online ou digitando (V6-022). Texto sempre como texto.
import { h, mount, header, toast, choiceSheet, confirmSheet } from '../ui.js';
import * as session from '../session.js';
import { formatTime, formatDateTime } from '../packages/protocol/src/time.js';
import { preparePhoto } from '../media.js';
import { openMedia, holdButton, playAudio } from './viewer.js';
import { CONFIG } from '../config.js';
import { startRecording, fmtDuration } from '../audio.js';
import { roomMenu } from './room-menu.js';

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
// Abaixo do limite do servidor (100 MiB) com folga para a cifra segmentada.
const MAX_VIDEO_BYTES = 95 * 1024 * 1024;
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
  let pick = { video: false, once: false };
  const progressBar = h('div', { class: 'progress', hidden: true });
  let videoJob = null;

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
    const { video, once } = pick;
    if (video) return sendVideo(f, once);
    try {
      toast('Preparando a foto…');
      const p = await preparePhoto(f);
      await S.client.sendMedia(roomId, p.bytes, { mode: once ? 'once' : 'media', mime: p.mime });
      p.bytes.fill(0);
      await render();
    } catch (e) { toast(`Não enviou: ${e.message}`); }
  };

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
      const { compress, VideoRejected } = await import('../video/compress.js');
      // Chromium dos testes não tem H.264; o app de verdade usa sempre H.264.
      const videoCodec = CONFIG.testHooks ? 'vp9' : 'avc';
      let r;
      try {
        for (const preset of ['padrao', 'economico']) {
          label.textContent = preset === 'padrao' ? 'Preparando o vídeo…' : 'Ficou grande; reduzindo a qualidade…';
          r = await compress(file, { preset, videoCodec, onProgress: (p) => { bar.value = p; }, signal: ctl.signal });
          if (r.blob.size <= MAX_VIDEO_BYTES) break;
          r = null;
        }
      } catch (e) {
        if (ctl.signal.aborted) return toast('Cancelado. Nada foi enviado.');
        throw e instanceof VideoRejected ? e : new Error(`não deu para preparar o vídeo (${e.message})`);
      }
      if (!r) throw new Error('vídeo grande demais mesmo comprimido. Nada foi enviado.');
      if (ctl.signal.aborted) return toast('Cancelado. Nada foi enviado.');
      label.textContent = 'Enviando cifrado…';
      bar.removeAttribute('value');
      bytes = new Uint8Array(await r.blob.arrayBuffer());
      await S.client.sendMedia(roomId, bytes, { mode: once ? 'once' : 'media', mime: 'video/mp4', duration: Math.round(r.stats.out.duration * 1000) });
      await render();
    } catch (e) { toast(`Não enviou: ${e.message}`); }
    finally { bytes?.fill(0); videoJob = null; progressBar.hidden = true; progressBar.replaceChildren(); }
  }

  const attach = async () => {
    const c = await choiceSheet('Enviar', [
      { label: 'Foto', value: 'photo' }, { label: 'Foto de ver uma vez', value: 'photo-once' },
      { label: 'Vídeo (até 5 min)', value: 'video' }, { label: 'Vídeo de ver uma vez', value: 'video-once' }]);
    if (!c) return;
    pick = { video: c.startsWith('video'), once: c.endsWith('-once') };
    fileIn.accept = pick.video ? 'video/*' : 'image/*';
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
          catch (e) { toast(`Não enviou: ${e.message}`); } finally { r.bytes.fill(0); }
        } }));
      recBar.hidden = false;
    } catch (e) { recording = null; toast(e.name === 'NotAllowedError' ? 'Microfone negado.' : `Não deu para gravar: ${e.message}`); }
  };

  const emojiPanel = h('div', { class: 'emoji-panel', hidden: true }, EMOJIS.map((e) => h('button', { class: 'emoji', type: 'button', text: e, onclick: () => { input.value += e; input.focus(); } })));

  mount(h('div', { class: 'chat' },
    header(session.roomTitle(view), { back: () => go('chats'), actions: [h('button', { class: 'icon', 'aria-label': 'Menu da conversa', text: '⋮', onclick: async () => { const r = await roomMenu(go, roomId); if (r === 'refresh') { view = await session.roomView(roomId, true); chatScreen(go, { roomId }); } } })] }),
    h('div', { class: 'policy muted small', text: policyLine(view) }),
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
    return h('li', { class: mine ? 'msg mine' : 'msg', onclick: (e) => { if (!e.target.closest('.hold, .open, .audio-box')) actions(m); } }, parts);
  }

  function mediaBlock(m, mine) {
    const load = () => S.client.openMedia(m);
    const what = mediaName(m);
    if (m.body.mode === 'once') {
      const a = what === 'Foto' ? 'a' : 'o';
      if (mine) return h('span', { class: 'media-tag', text: `${what} de ver uma vez (enviad${a})` });
      if (m.consumed || !m.body.key) return h('span', { class: 'media-tag', text: `${what} de ver uma vez (já vist${a})` });
      // O núcleo do cliente já apaga a chave depois da tentativa; aqui só redesenha.
      return holdButton('Segure para ver (uma vez)', load, m.body.mime, async (err) => {
        if (err && !/410|404/.test(err.message)) toast(`Não abriu: ${err.message}`);
        setTimeout(() => render().catch(() => {}), 300);
      });
    }
    if (/^audio\//.test(m.body.mime)) {
      const host = h('span', { class: 'audio-host' });
      return h('span', {}, h('button', { class: 'open media-tag', text: `Áudio · ${fmtDuration(m.body.duration ?? 0)} · tocar`, onclick: () => playAudio(load, m.body.mime, host).catch((e) => toast(`Não tocou: ${e.message}`)) }), host);
    }
    const label = what === 'Vídeo' ? `Vídeo · ${fmtDuration(m.body.duration ?? 0)} · tocar para ver` : 'Foto · tocar para ver';
    return h('button', { class: 'open media-tag', text: label, onclick: () => openMedia(load, m.body.mime).catch((e) => toast(`Não abriu: ${e.message}`)) });
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

function mediaName(m) {
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
