// Foto: recodifica no aparelho antes de cifrar (V7-016, §14). Desenhar num
// canvas e gerar um JPEG novo descarta EXIF, GPS e prévias embutidas.
export const MAX_PHOTO_SIDE = 2048;

export async function preparePhoto(file) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) throw new Error('Formato de foto não aceito.');
  if (file.size > 40 * 1024 * 1024) throw new Error('Foto grande demais.');
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const s = Math.min(1, MAX_PHOTO_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * s), hgt = Math.round(bmp.height * s);
  const canvas = new OffscreenCanvas(w, hgt);
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, hgt);
  bmp.close();
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/jpeg', width: w, height: hgt };
}
