/** שמירה ושיתוף של קבצים שנוצרו בדפדפן. אין העלאה לשרת. */
export interface OutFile {
  name: string;
  blob: Blob;
  mime: string;
}

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

/** מוריד כמה קבצים בזה אחר זה (רווח קצר ביניהם כדי שהדפדפן לא יחסום). */
export async function downloadFiles(files: OutFile[]) {
  for (const f of files) {
    downloadBlob(f.blob, f.name);
    if (files.length > 1) await new Promise((r) => setTimeout(r, 600));
  }
}

const toFiles = (files: OutFile[]) => files.map((f) => new File([f.blob], f.name, { type: f.mime }));

export function canShareFiles(files: OutFile[]): boolean {
  try {
    if (!navigator.share || !navigator.canShare) return false;
    return navigator.canShare({ files: toFiles(files) });
  } catch {
    return false;
  }
}

/** מחזיר true אם נפתח חלון השיתוף והמשתמש לא ביטל. שגיאות אחרות נזרקות הלאה (עם name). */
export async function shareFiles(files: OutFile[], title: string): Promise<boolean> {
  try {
    await navigator.share({ files: toFiles(files), title });
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
