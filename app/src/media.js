// Foto: recodifica no aparelho antes de cifrar (V7-016, §14). Desenhar num
// canvas e gerar um JPEG novo descarta EXIF, GPS e prévias embutidas.
export const MAX_PHOTO_SIDE = 2048;

export async function preparePhoto(file, { maxSide = MAX_PHOTO_SIDE, square = false } = {}) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) throw new Error('Formato de foto não aceito.');
  if (file.size > 40 * 1024 * 1024) throw new Error('Foto grande demais.');
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  // Foto de perfil/grupo: recorte quadrado central.
  const side = Math.min(bmp.width, bmp.height);
  const [sx, sy, sw, sh] = square ? [(bmp.width - side) / 2, (bmp.height - side) / 2, side, side] : [0, 0, bmp.width, bmp.height];
  const s = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.round(sw * s), hgt = Math.round(sh * s);
  const canvas = new OffscreenCanvas(w, hgt);
  canvas.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, w, hgt);
  bmp.close();
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/jpeg', width: w, height: hgt };
}
