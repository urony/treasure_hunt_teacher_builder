import { Game, LIMITS, RouteType, SCHEMA_VERSION } from './types';

const ID_RE = /^[A-Za-z0-9_-]{4,64}$/;

export function isImageId(s: unknown): s is string {
  return typeof s === 'string' && ID_RE.test(s);
}

/** רק https מותר. מחזיר URL מנורמל או null. */
export function safeHttpsUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;
  }
}

export function collectImageIds(game: Game): string[] {
  const ids = new Set<string>();
  if (game.intro.imageId) ids.add(game.intro.imageId);
  for (const s of game.stations) if (s.imageId) ids.add(s.imageId);
  return [...ids];
}

const ROUTES: RouteType[] = ['linear', 'circular', 'free'];

/** מחזיר רשימת שגיאות בעברית. רשימה ריקה = תקין. פועל גם בלקוח וגם בשרת. */
export function validateGame(g: unknown): string[] {
  const errs: string[] = [];
  if (!g || typeof g !== 'object') return ['נתוני המשחק אינם תקינים.'];
  const game = g as Game;
  if (game.schemaVersion !== SCHEMA_VERSION) errs.push('גרסת הקובץ אינה נתמכת.');
  if (typeof game.title !== 'string' || !game.title.trim()) errs.push('חסר שם למשחק.');
  else if (game.title.length > LIMITS.title) errs.push(`שם המשחק ארוך מדי (עד ${LIMITS.title} תווים).`);
  if (!ROUTES.includes(game.routeType)) errs.push('לא נבחר סוג מסלול.');

  const intro = game.intro;
  if (!intro || typeof intro !== 'object') {
    errs.push('מסך הפתיחה חסר.');
  } else {
    if (typeof intro.text !== 'string' || intro.text.length > LIMITS.text) errs.push('טקסט מסך הפתיחה ארוך מדי.');
    if (intro.imageId !== undefined && !isImageId(intro.imageId)) errs.push('תמונת מסך הפתיחה אינה תקינה.');
    checkLink(intro.link, 'במסך הפתיחה', errs);
  }

  if (!Array.isArray(game.stations) || game.stations.length === 0) {
    errs.push('צריך להוסיף לפחות תחנה אחת.');
    return errs;
  }
  if (game.stations.length > LIMITS.maxStations) errs.push(`אפשר עד ${LIMITS.maxStations} תחנות.`);

  const seen = new Set<string>();
  game.stations.forEach((s, i) => {
    const where = `בתחנה ${i + 1}`;
    if (!s || typeof s !== 'object') return void errs.push(`${where}: נתונים לא תקינים.`);
    if (!ID_RE.test(String(s.id)) || seen.has(s.id)) errs.push(`${where}: מזהה לא תקין.`);
    seen.add(s.id);
    if (typeof s.name !== 'string' || !s.name.trim()) errs.push(`${where}: חסר שם.`);
    else if (s.name.length > LIMITS.stationName) errs.push(`${where}: השם ארוך מדי.`);
    if (typeof s.content !== 'string' || s.content.length > LIMITS.text) errs.push(`${where}: התוכן ארוך מדי.`);
    if (s.imageId !== undefined && !isImageId(s.imageId)) errs.push(`${where}: תמונה לא תקינה.`);
    checkLink(s.link, where, errs);
    const sub = s.submit;
    if (!sub || typeof sub.text !== 'boolean' || typeof sub.photo !== 'boolean' || typeof sub.audio !== 'boolean') {
      errs.push(`${where}: הגדרת התוצר לא תקינה.`);
    }
    if (s.code) {
      const c = s.code;
      const answers = Array.isArray(c.answers) ? c.answers.map((a) => String(a).trim()).filter(Boolean) : [];
      if (answers.length === 0) errs.push(`${where}: בקוד מעבר צריך לפחות תשובה מתקבלת אחת.`);
      if (answers.length > LIMITS.maxAnswers || answers.some((a) => a.length > LIMITS.codeAnswer)) {
        errs.push(`${where}: יותר מדי תשובות או תשובה ארוכה מדי.`);
      }
      if (typeof c.prompt !== 'string' || c.prompt.length > LIMITS.text) errs.push(`${where}: שאלת הקוד ארוכה מדי.`);
      if (typeof c.reveal !== 'string' || c.reveal.length > LIMITS.text) errs.push(`${where}: ההודעה אחרי תשובה נכונה ארוכה מדי.`);
      if (c.hint !== undefined && (typeof c.hint !== 'string' || c.hint.length > LIMITS.text)) errs.push(`${where}: הרמז ארוך מדי.`);
    }
  });
  return errs;
}

function checkLink(link: string | undefined, where: string, errs: string[]) {
  if (link === undefined || link === '') return;
  if (typeof link !== 'string' || link.length > LIMITS.link || !safeHttpsUrl(link)) {
    errs.push(`${where}: הקישור חייב להתחיל ב-https://`);
  }
}

/** מנקה שדות ריקים לפני שמירה/פרסום. */
export function cleanGame(game: Game): Game {
  const trimOpt = (s?: string) => (s && s.trim() ? s.trim() : undefined);
  return {
    schemaVersion: SCHEMA_VERSION,
    title: game.title.trim(),
    routeType: game.routeType,
    intro: { text: game.intro.text, imageId: game.intro.imageId, link: trimOpt(game.intro.link) },
    stations: game.stations.map((s) => ({
      id: s.id,
      name: s.name.trim(),
      content: s.content,
      imageId: s.imageId,
      link: trimOpt(s.link),
      submit: { text: !!s.submit.text, photo: !!s.submit.photo, audio: !!s.submit.audio },
      code: s.code
        ? { prompt: s.code.prompt, answers: s.code.answers.map((a) => a.trim()).filter(Boolean), reveal: s.code.reveal, hint: trimOpt(s.code.hint) }
        : undefined,
    })),
  };
}
