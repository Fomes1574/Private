// Escolher imagem para foto de perfil/grupo ou fundo. No modo máximo (padrão)
// só pela câmera do app; com ele desligado, a pessoa escolhe câmera ou galeria.
// Sempre recodificada (sem metadados).
import { h, toast, choiceSheet } from './ui.js';
import * as session from './session.js';
import { openCamera } from './camera.js';
import { nativePickerAvailable, pickInApp, readNativeAttachment } from './attachment-picker.js';
import { preparePhoto } from './media.js';

function fromGallery() {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'image/*', hidden: true });
    input.onchange = () => { const f = input.files[0]; input.remove(); resolve(f ?? null); };
    document.body.append(input);
    input.click();
  });
}

export async function pickImage({ maxSide = 512, square = false, facing = 'user', resume = { target: 'settings', action: 'profile' } } = {}) {
  let source = 'camera';
  if (!session.maxMode()) {
    source = await choiceSheet('De onde?', [{ label: 'Câmera do app', value: 'camera' }, { label: 'Galeria', value: 'gallery' }]);
    if (!source) return null;
  }
  let file = null, shot = null;
  if (source === 'camera') {
    shot = await openCamera({ mode: 'photo', facing });
    if (!shot) return null;
    file = new Blob([shot.bytes], { type: 'image/jpeg' });
  } else {
    if (nativePickerAvailable()) {
      // D13: volta rápida lê aqui mesmo; se trancou, a seleção espera o PIN.
      const owner = session.S.client;
      const open = () => session.S.unlocked && session.S.client === owner;
      const got = await pickInApp(resume.roomId ?? null, { ...resume, square, maxSide }, open).catch(() => null);
      if (!got) return null;
      try { file = await readNativeAttachment(got, { signal: new AbortController().signal, allowed: open }); }
      catch (e) { toast(e.message); return null; }
    }
    else file = await fromGallery();
    if (!file) return null;
  }
  try { return (await preparePhoto(file, { maxSide, square })).bytes; }
  catch (e) { toast(e.message); return null; }
  finally { shot?.bytes.fill(0); }
}
