/**
 * נרמול תשובת קוד מעבר. מה שמנורמל (ורק זה):
 * - הסרת ניקוד וטעמי מקרא עבריים (U+0591–U+05C7)
 * - הסרת סימני כיווניות נסתרים (LRM, RLM ודומיהם)
 * - הפיכת אותיות אנגליות לקטנות
 * - רווחים: trim וצמצום רווחים כפולים לרווח אחד
 * אין התאמה סמנטית, תיקון איות או בינה מלאכותית.
 */
export function normalizeAnswer(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/[֑-ׇ]/g, '')
    .replace(/[​-‏‪-‮⁦-⁩]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function isCorrectAnswer(input: string, accepted: string[]): boolean {
  const n = normalizeAnswer(input);
  if (!n) return false;
  return accepted.some((a) => normalizeAnswer(a) === n);
}
