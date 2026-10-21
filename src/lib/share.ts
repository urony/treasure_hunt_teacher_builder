/** שמירה ושיתוף של קובץ שנוצר בדפדפן. אין העלאה לשרת. */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function canShareFile(blob: Blob, fileName: string, mime: string): boolean {
  try {
    if (!navigator.share || !navigator.canShare) return false;
    return navigator.canShare({ files: [new File([blob], fileName, { type: mime })] });
  } catch {
    return false;
  }
}

/** מחזיר true אם נפתח חלון השיתוף והמשתמש לא ביטל. */
export async function shareFile(blob: Blob, fileName: string, mime: string, title: string): Promise<boolean> {
  try {
    await navigator.share({ files: [new File([blob], fileName, { type: mime })], title });
    return true;
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return false;
    throw e;
  }
}

/**
 * זיהוי היוריסטי של דפדפן פנימי (וואטסאפ, פייסבוק וכד'). אינו אמין במאה אחוז —
 * לכן משמש רק להצגת טיפ, לא לחסימה.
 */
export function looksLikeInAppBrowser(ua = navigator.userAgent): boolean {
  const isIos = /iPhone|iPad|iPod/.test(ua);
  if (/FBAN|FBAV|Instagram|Line\/|WhatsApp|Telegram/i.test(ua)) return true;
  if (isIos) return !/Safari\//.test(ua);
  return /; wv\)/.test(ua);
}
