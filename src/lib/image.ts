import { LIMITS } from '../shared/types';

async function decode(file: Blob): Promise<{ source: CanvasImageSource; w: number; h: number; close: () => void }> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { source: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() };
  } catch {
    // fallback ל-<img> (דפדפנים ישנים)
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { source: img, w: img.naturalWidth, h: img.naturalHeight, close: () => {} };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', quality),
  );
}

export interface CompressOptions {
  maxDim?: number;
  targetBytes?: number;
}

/**
 * מקטין ומכווץ תמונה ל-JPEG. מנסה להגיע ל-targetBytes על ידי הורדת איכות ואז הקטנת מידות.
 * זורק שגיאה בעברית אם הקובץ אינו תמונה שהדפדפן יכול לפענח.
 */
export async function compressImage(file: Blob, opts: CompressOptions = {}): Promise<Blob> {
  const maxDim = opts.maxDim ?? LIMITS.imageMaxDim;
  const target = opts.targetBytes ?? LIMITS.imageTargetBytes;
  let dec;
  try {
    dec = await decode(file);
  } catch {
    throw new Error('לא הצלחנו לקרוא את התמונה. נסו תמונה אחרת (JPEG, PNG או WebP).');
  }
  const canvas = document.createElement('canvas');
  try {
    let scale = Math.min(1, maxDim / Math.max(dec.w, dec.h));
    let best: Blob | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      canvas.width = Math.max(1, Math.round(dec.w * scale));
      canvas.height = Math.max(1, Math.round(dec.h * scale));
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(dec.source, 0, 0, canvas.width, canvas.height);
      for (const q of [0.85, 0.75, 0.65, 0.55, 0.45]) {
        best = await toBlob(canvas, q);
        if (best.size <= target) return best;
      }
      scale *= 0.8;
    }
    return best!;
  } finally {
    dec.close();
    canvas.width = canvas.height = 0;
  }
}
