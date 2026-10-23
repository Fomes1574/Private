// Stories (§22): foto ou vídeo para quem a pessoa escolher no círculo, com
// prazo (24 h por padrão, dentro de 12 h–15 d). Sem contagem nem lista de
// quem viu. Quem publicou pode apagar antes de vencer (some para todos).
import { h, mount, header, toast, confirmSheet } from '../ui.js';
import * as session from '../session.js';
import { formatTime, formatDateTime } from '../packages/protocol/src/time.js';
import { TTL_OPTIONS, describeTtl, DAY } from '../packages/protocol/src/ttl.js';
import { CIRCLE_ROOM_ID } from '../packages/protocol/src/room.js';
import { preparePhoto } from '../media.js';
import { prepareVideo } from '../video-prep.js';
import { openMedia } from './viewer.js';
import { avatar } from '../avatar.js';

export async function storiesScreen(go) {
  const S = session.S;
  const list = h('ul', { class: 'list' });
  mount(h('div', {},
    header('Stories', { back: () => go('chats'), actions: [h('button', { class: 'icon', 'aria-label': 'Publicar story', text: '+', onclick: () => compose(go) })] }),
    h('main', {},
      h('p', { class: 'muted small', text: 'Ninguém fica sabendo quem viu. Cada story some no prazo escolhido.' }),
      list)));

  const render = async () => {
    const all = await S.client.stories();
    all.sort((a, b) => b.acceptedAt - a.acceptedAt);
    list.replaceChildren(...(all.length ? all.map((m) => {
      const mine = m.sender === S.client.userId;
      const what = /^video\//.test(m.body.mime) ? 'Vídeo' : 'Foto';
      return h('li', { class: 'story-row' },
        h('button', { class: 'row-btn open', onclick: () => openMedia(() => S.client.openMedia(m), m.body.mime).catch((e) => toast(`Não abriu: ${e.message}`)) },
          avatar(session.nameOf(m.sender), session.photoOf(m.sender)),
          h('span', { class: 'grow' },
            h('span', { class: 'title', text: mine ? 'Você' : session.nameOf(m.sender) }),
            h('span', { class: 'muted small', text: `${what} · ${formatTime(m.acceptedAt)}${m.body.caption ? ' · ' + m.body.caption : ''}` })),
          h('span', { class: 'muted small', text: `some ${formatDateTime(m.expiresAt)}` })),
        mine ? h('button', { class: 'secondary small', text: 'Apagar', onclick: async () => {
          if (!await confirmSheet('Apagar esta story para todos agora?', 'Apagar')) return;
          try {
            await S.client.api.post(`/v1/media/${m.body.mediaId}/revoke`).catch(() => {});
            await S.client.deleteForAll(CIRCLE_ROOM_ID, m.msgId);
            await render();
          } catch (e) { toast(`Não deu: ${e.message}`); }
        } }) : null);
    }) : [h('li', { class: 'empty', text: 'Nenhuma story no momento.' })]));
  };
  await render().catch((e) => toast(`Não deu para carregar: ${e.message}`));
  return session.onChange((w) => { if (w === 'synced') render().catch(() => {}); });
}

// Publicar: escolher arquivo, audiência (padrão: todo o círculo), prazo e legenda.
function compose(go) {
  const S = session.S;
  const people = Object.entries(S.nicknames).filter(([u]) => u !== S.client.userId);
  if (!people.length) return toast('Ainda não há outras pessoas no círculo.');
  const file = h('input', { id: 'story-file', type: 'file', accept: 'image/*,video/*' });
  const boxes = people.map(([u, n]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: u, checked: true }), n.nickname));
  const ttl = h('select', { id: 'story-ttl' }, TTL_OPTIONS.map((s) => h('option', { value: String(s), text: describeTtl(s), selected: s === DAY })));
  const caption = h('input', { id: 'story-caption', maxlength: '1000', autocomplete: 'off', placeholder: 'Legenda (opcional)' });
  const status = h('p', { class: 'muted small', 'aria-live': 'polite' });
  const close = () => sheet.remove();
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, h('form', { class: 'sheet-box', onsubmit: async (e) => {
    e.preventDefault();
    const f = file.files[0];
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
    } catch (err) { toast(`Não publicou: ${err.message}`); status.textContent = ''; btn.disabled = false; }
    finally { bytes?.fill(0); }
  } },
    h('p', { text: 'Nova story' }),
    h('label', { for: 'story-file', text: 'Foto ou vídeo (até 5 min)' }), file,
    h('fieldset', {}, h('legend', { text: 'Quem pode ver' }), boxes),
    h('label', { for: 'story-ttl', text: 'Some em' }), ttl,
    caption, status,
    h('button', { class: 'block', text: 'Publicar' }),
    h('button', { type: 'button', class: 'secondary block', text: 'Cancelar', onclick: close })));
  document.body.append(sheet);
}
