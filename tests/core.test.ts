import { describe, expect, it } from 'vitest';
import { encodeWav } from '../src/lib/audio';
import { exportGameZip, importGameZip } from '../src/lib/gamezip';
import { buildPdf } from '../src/lib/pdf';
import { stationOutcome } from '../src/lib/status';
import { isCorrectAnswer, normalizeAnswer } from '../src/shared/normalize';
import { Game, Station } from '../src/shared/types';
import { cleanGame, safeHttpsUrl, validateGame } from '../src/shared/validate';

const station = (over: Partial<Station> = {}): Station => ({
  id: 'abcd1234',
  name: 'תחנה 1',
  content: 'שלום',
  submit: { text: false, photo: false, audio: false },
  ...over,
});
const game = (over: Partial<Game> = {}): Game => ({
  schemaVersion: 1,
  title: 'משחק',
  routeType: 'linear',
  intro: { text: 'ברוכים הבאים' },
  stations: [station()],
  ...over,
});

describe('normalizeAnswer', () => {
  it('מסיר ניקוד, רווחים כפולים ואותיות גדולות באנגלית', () => {
    expect(normalizeAnswer('  שָׁלוֹם   עולם ')).toBe('שלום עולם');
    expect(normalizeAnswer('  HeLLo   World')).toBe('hello world');
  });
  it('מסיר סימני כיווניות נסתרים', () => {
    expect(normalizeAnswer('‏5‎')).toBe('5');
  });
  it('מקבל כמה תשובות אך לא התאמה סמנטית', () => {
    expect(isCorrectAnswer(' חמש ', ['5', 'חמש'])).toBe(true);
    expect(isCorrectAnswer('5', ['5', 'חמש'])).toBe(true);
    expect(isCorrectAnswer('חמישה', ['5', 'חמש'])).toBe(false);
    expect(isCorrectAnswer('', [''])).toBe(false);
  });
});

describe('safeHttpsUrl', () => {
  it('מתיר רק https', () => {
    expect(safeHttpsUrl('https://youtube.com/watch?v=1')).toBeTruthy();
    expect(safeHttpsUrl('http://example.com')).toBeNull();
    expect(safeHttpsUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpsUrl('data:text/html,<script>')).toBeNull();
    expect(safeHttpsUrl('not a url')).toBeNull();
  });
});

describe('validateGame', () => {
  it('משחק תקין', () => expect(validateGame(game())).toEqual([]));
  it('דורש שם משחק ושם תחנה', () => {
    expect(validateGame(game({ title: ' ' })).length).toBe(1);
    expect(validateGame(game({ stations: [station({ name: '' })] })).length).toBe(1);
  });
  it('דורש לפחות תחנה אחת ומגביל ל-25', () => {
    expect(validateGame(game({ stations: [] })).length).toBe(1);
    const many = Array.from({ length: 26 }, (_, i) => station({ id: `id${String(i).padStart(4, '0')}` }));
    expect(validateGame(game({ stations: many })).length).toBeGreaterThan(0);
  });
  it('דוחה קישור לא בטוח', () => {
    expect(validateGame(game({ intro: { text: '', link: 'javascript:alert(1)' } })).length).toBe(1);
    expect(validateGame(game({ stations: [station({ link: 'http://x.com' })] })).length).toBe(1);
  });
  it('קוד מעבר דורש תשובה', () => {
    const s = station({ code: { prompt: '', answers: ['  '], reveal: '' } });
    expect(validateGame(game({ stations: [s] })).length).toBe(1);
  });
  it('מזהי תחנה כפולים נדחים', () => {
    expect(validateGame(game({ stations: [station(), station()] })).length).toBeGreaterThan(0);
  });
  it('cleanGame מנקה תשובות ריקות ומסיר שדות מיותרים', () => {
    const g = cleanGame(game({ stations: [station({ code: { prompt: '', answers: ['5', ' ', 'חמש '], reveal: '' } })] }));
    expect(g.stations[0].code?.answers).toEqual(['5', 'חמש']);
  });
});

describe('stationOutcome', () => {
  const s = station({ submit: { text: true, photo: true, audio: false } });
  it('לא ביקר', () => expect(stationOutcome(s, undefined, false)).toBe('notVisited'));
  it('ביקר ולא נדרש תוצר', () => expect(stationOutcome(station(), undefined, true)).toBe('notRequired'));
  it('נדרש ולא הוגש', () => expect(stationOutcome(s, { text: '', photos: [] }, true)).toBe('missing'));
  it('חלקי', () => expect(stationOutcome(s, { text: 'כן', photos: [] }, true)).toBe('partial'));
  it('מלא', () => expect(stationOutcome(s, { text: 'כן', photos: ['k'] }, true)).toBe('full'));
});

describe('buildPdf', () => {
  it('יוצר PDF עם xref תקין', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const blob = buildPdf([
      { jpeg, width: 10, height: 10 },
      { jpeg, width: 10, height: 10 },
    ]);
    const text = new TextDecoder('latin1').decode(new Uint8Array(await blob.arrayBuffer()));
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)![1]);
    // המיקום שהוכרז חייב להצביע על המילה xref (offsets בבייטים; כל התוכן עד שם ASCII/latin1 למעט הכותרת הבינארית)
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(startxref, startxref + 4))).toBe('xref');
    expect(text).toContain('/Count 2');
    expect((text.match(/\/Type \/Page /g) ?? []).length).toBe(2);
  });
});

describe('ייצוא/ייבוא משחק', () => {
  it('מחזיר את אותו משחק עם תמונות', async () => {
    const g = game({ intro: { text: 'x', imageId: 'img12345' } });
    const png = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    const zip = await exportGameZip(g, async () => ({ blob: png, mime: 'image/jpeg', ext: 'jpg' }));
    const imp = await importGameZip(zip);
    expect(imp.game.title).toBe('משחק');
    expect(imp.images.get('img12345')?.blob.size).toBe(3);
    expect(imp.warnings).toEqual([]);
  });
  it('מסיר הפניה לתמונה חסרה ומתריע', async () => {
    const g = game({ intro: { text: 'x', imageId: 'img12345' } });
    const zip = await exportGameZip(g, async () => undefined);
    const imp = await importGameZip(zip);
    expect(imp.game.intro.imageId).toBeUndefined();
    expect(imp.warnings.length).toBe(1);
  });
  it('דוחה קובץ שאינו משחק', async () => {
    await expect(importGameZip(new Blob(['not a zip']))).rejects.toThrow();
  });
});

describe('encodeWav', () => {
  it('יוצר כותרת WAV תקינה', async () => {
    const samples = new Float32Array(16000).fill(0.5);
    const blob = encodeWav(samples, 16000);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const txt = (a: number, b: number) => new TextDecoder().decode(bytes.slice(a, b));
    expect(txt(0, 4)).toBe('RIFF');
    expect(txt(8, 12)).toBe('WAVE');
    expect(txt(36, 40)).toBe('data');
    expect(bytes.length).toBe(44 + 16000 * 2);
    const v = new DataView(bytes.buffer);
    expect(v.getUint32(24, true)).toBe(16000); // קצב דגימה
    expect(v.getUint16(22, true)).toBe(1); // מונו
    expect(v.getInt16(44, true)).toBeGreaterThan(16000); // 0.5 -> ~16383
  });
  it('חותך ערכים חריגים', async () => {
    const bytes = new Uint8Array(await encodeWav(new Float32Array([2, -2]), 8000).arrayBuffer());
    const v = new DataView(bytes.buffer);
    expect(v.getInt16(44, true)).toBe(32767);
    expect(v.getInt16(46, true)).toBe(-32768);
  });
});

describe('רמז אחרי טעות', () => {
  it('נשמר ב-cleanGame ומאומת באורך', () => {
    const g = cleanGame(game({ stations: [station({ code: { prompt: '', answers: ['5'], reveal: '', hint: '  חשבו שוב  ' } })] }));
    expect(g.stations[0].code?.hint).toBe('חשבו שוב');
    const bad = game({ stations: [station({ code: { prompt: '', answers: ['5'], reveal: '', hint: 'x'.repeat(5000) } })] });
    expect(validateGame(bad).length).toBe(1);
  });
});
