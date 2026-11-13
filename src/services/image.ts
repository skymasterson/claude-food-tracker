async function draw(file: Blob, maxSide: number, quality: number): Promise<{ blob: Blob; dataUrl: string }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process the image on this device.');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('Could not process the image on this device.');
  return { blob, dataUrl: canvas.toDataURL('image/jpeg', quality) };
}

/** Resize for analysis: longest side about 1,280 px, JPEG. */
export function resizeForAnalysis(file: Blob) {
  return draw(file, 1280, 0.82);
}

/** Thumbnail stored with the entry: small enough to keep backups light, large enough to print in the care-team summary. */
export async function makeThumbnail(file: Blob): Promise<string> {
  return (await draw(file, 320, 0.72)).dataUrl;
}

export function base64Of(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}
