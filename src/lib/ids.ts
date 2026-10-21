export function uid(): string {
  const c: Crypto = globalThis.crypto;
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** שם קובץ בטוח לתצוגה (עברית מותרת), בלי תווים אסורים במערכות קבצים */
export function safeFileName(s: string, fallback: string): string {
  const cleaned = s
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50);
  return cleaned || fallback;
}
