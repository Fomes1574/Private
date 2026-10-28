// Stories (§22): foto ou vídeo para quem a pessoa escolher no círculo, com
// prazo (24 h por padrão, dentro de 12 h–15 d). Sem contagem nem lista de
// quem viu. Quem publicou pode apagar antes de vencer (some para todos).
import { h, mount, header, iconButton, toast, confirmSheet, errText } from '../ui.js';
import * as session from '../session.js';
import { formatTime, formatDateTime } from '../packages/protocol/src/time.js';
import { TTL_OPTIONS, describeTtl, DAY } from '../packages/protocol/src/ttl.js';
import { CIRCLE_ROOM_ID } from '../packages/protocol/src/room.js';
import { preparePhoto } from '../media.js';
import { prepareVideo } from '../video-prep.js';
import { openMedia } from './viewer.js';
import { sensitiveScope } from '../sensitive-scope.js';
import { nativePickerAvailable, pickInApp, readNativeAttachment } from '../attachment-picker.js';
import { avatar } from '../avatar.js';
import { openCamera } from '../camera.js';

export async function storiesScreen(go, { attachment = null } = {}) {
  const S = session.S;
  const owner = sensitiveScope({ transient: false });
  const list = h('ul', { class: 'list' });
  mount(h('div', {},
    header('Stories', { back: () => go('chats'), actions: [iconButton('plus', 'Publicar story', () => compose(go))] }),
    h('main', {},
      h('p', { class: 'muted small', text: 'Ninguém sabe quem viu. Cada story some no prazo.' }),
      list)));

  const render = async () => {
    const all = await S.client.stories();
    all.sort((a, b) => b.acceptedAt - a.acceptedAt);
    list.replaceChildren(...(all.length ? all.map((m) => {
      const mine = m.sender === S.client.userId;
      const what = /^video\//.test(m.body.mime) ? 'Vídeo' : 'Foto';
      return h('li', { class: 'story-row' },
        h('button', { class: 'row-btn open', onclick: () => openMedia((options) => S.client.openMedia(m, options), m.body.mime).catch((e) => toast(`Não abriu: ${errText(e)}`)) },
          avatar(session.nameOf(m.sender), session.photoOf(m.sender)),
          h('span', { class: 'grow' },
            h('span', { class: 'title', text: mine ? 'Você' : session.nameOf(m.sender) }),
            h('span', { class: 'muted small', text: `${what} · ${formatTime(m.acceptedAt)}${m.body.caption ? ' · ' + m.body.caption : ''}` })),
          h('span', { class: 'muted small', text: `some ${formatDateTime(m.expiresAt)}` })),
        mine ? h('button', { class: 'secondary small', text: 'Apagar', onclick: async () => {
          if (!await confirmSheet('Apagar esta story para todos agora?', 'Apagar')) return;
          try {
            await S.client.deleteForAll(CIRCLE_ROOM_ID, m.msgId, { mediaId: m.body.mediaId });
            await render();
          } catch (e) { toast(`Não deu: ${errText(e)}`); }
        } }) : null);
    }) : [h('li', { class: 'empty', text: 'Nenhuma story no momento.' })]));
  };
  await render().catch((e) => toast(`Não deu para carregar: ${errText(e)}`));
  const off = session.onChange((w) => { if (w === 'synced') render().catch(() => {}); });
  if (attachment?.pick.target === 'stories') {
    readNativeAttachment(attachment, { signal: owner.signal, allowed: owner.valid }).then((file) => { if (owner.valid()) compose(go, file); }).catch((e) => { if (owner.valid()) toast(`Não abriu: ${errText(e)}`); });
  }
  return () => { owner.cancel(); off(); };
}

// Publicar: escolher arquivo, audiência (padrão: todo o círculo), prazo e legenda.
function compose(go, selectedFile = null) {
  const S = session.S;
  // S3: só quem a administradora confirmou pode ser audiência.
  const roster = S.client.circleRoster();
  const people = Object.entries(S.nicknames).filter(([u]) => u !== S.client.userId && (!roster || roster.includes(u)));
  if (!people.length) return toast('Ainda não há outras pessoas no círculo.');
  // Câmera do app sempre; galeria só com o modo máximo desligado.
  const file = h('input', { id: 'story-file', type: 'file', accept: 'image/*,video/*', hidden: session.maxMode() || nativePickerAvailable() });
  let shot = null;
  const shotInfo = h('p', { class: 'muted small', 'aria-live': 'polite', text: '' });
  const camBtn = (label, mode) => h('button', { type: 'button', class: 'secondary small', text: label, onclick: async () => {
    const r = await openCamera({ mode });
    if (!r) return;
    shot?.bytes?.fill(0);
    shot = r;
    file.value = '';
    shotInfo.textContent = mode === 'photo' ? 'Foto pronta.' : 'Vídeo pronto.';
  } });
  const boxes = people.map(([u, n]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: u, checked: true }), n.nickname));
  const ttl = h('select', { id: 'story-ttl' }, TTL_OPTIONS.map((s) => h('option', { value: String(s), text: describeTtl(s), selected: s === DAY })));
  const caption = h('input', { id: 'story-caption', maxlength: '1000', autocomplete: 'off', placeholder: 'Legenda (opcional)' });
  const status = h('p', { class: 'muted small', 'aria-live': 'polite' });
  const close = () => sheet.remove();
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, h('form', { class: 'sheet-box', onsubmit: async (e) => {
    e.preventDefault();
    const f = shot ? (shot.blob ?? new Blob([shot.bytes], { type: shot.mime })) : selectedFile ?? file.files[0];
    const audience = boxes.map((b) => b.querySelector('input')).filter((i) => i.checked).map((i) => i.value);
    if (!f) return toast('Escolha uma foto ou um vídeo.');
    if (!audience.length) return toast('Escolha pelo menos uma pessoa.');
    const btn = e.submitter ?? sheet.querySelector('button.block');
    btn.disabled = true;
    let bytes = null;
    try {
      let mime, duration;
      if (/^video\//.test(f.type)) {
        status.textContent = 'Preparando o vídeo…';
        ({ bytes, duration } = await prepareVideo(f, { onProgress: (p) => { status.textContent = `Preparando o vídeo… ${Math.round(p * 100)}%`; } }));
        mime = 'video/mp4';
      } else {
        status.textContent = 'Preparando a foto…';
        const p = await preparePhoto(f);
        bytes = p.bytes; mime = p.mime;
      }
      status.textContent = 'Publicando cifrado…';
      await S.client.sendStory(bytes, { mime, audience, ttl: Number(ttl.value), caption: caption.value.trim() || undefined, duration });
      close();
      toast('Story publicada.');
      go('stories');
    } catch (err) { toast(`Não publicou: ${errText(err)}`); status.textContent = ''; btn.disabled = false; }
    finally { bytes?.fill(0); shot?.bytes?.fill(0); }
  } },
    h('p', { text: 'Nova story' }),
    h('div', { class: 'row' }, camBtn('Câmera: foto', 'photo'), camBtn('Câmera: vídeo', 'video')), shotInfo,
    session.maxMode() ? null : nativePickerAvailable() ? h('button', { type: 'button', class: 'secondary', text: 'Galeria', onclick: async () => { const got = await pickInApp(null, { media: true, target: 'stories' }, () => session.S.unlocked).catch(() => null); if (got) { close(); go('stories', { attachment: got }); } } }) : h('label', { for: 'story-file', text: 'Ou da galeria: foto ou vídeo (até 5 min)' }), file,
    selectedFile ? h('p', { text: 'Confira quem vai ver e a legenda.' }) : null,
    h('fieldset', {}, h('legend', { text: 'Quem pode ver' }), boxes),
    h('label', { for: 'story-ttl', text: 'Some em' }), ttl,
    caption, status,
    h('button', { class: 'block', text: 'Publicar' }),
    h('button', { type: 'button', class: 'secondary block', text: 'Cancelar', onclick: close })));
  document.body.append(sheet);
}
