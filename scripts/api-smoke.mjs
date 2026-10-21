// בדיקות עשן ל-API מול `wrangler dev` רץ (ברירת מחדל http://localhost:8787).
// שימוש: node scripts/api-smoke.mjs [baseUrl] [--rate]   (--rate בודק גם הגבלת קצב, ומרוקן את מכסת היצירה של ה-IP)
const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:8787';
const checkRate = process.argv.includes('--rate');
let failed = 0;
const ok = (cond, name, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`);
  if (!cond) failed++;
};
const j = (r) => r.json().catch(() => ({}));

const game = (over = {}) => ({
  schemaVersion: 1,
  title: 'בדיקה',
  routeType: 'linear',
  intro: { text: 'שלום' },
  stations: [{ id: 'st000001', name: 'תחנה 1', content: 'x', submit: { text: true, photo: false, audio: false } }],
  ...over,
});

// JPEG מינימלי תקין לפי חתימה (השרת בודק חתימה, לא פענוח)
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

const post = (body, headers = {}) =>
  fetch(`${base}/api/games`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

// --- יצירה
let r = await post({ game: game() });
const created = await j(r);
ok(r.status === 201 && created.id?.length === 10 && created.token?.length >= 40, 'יצירת משחק מחזירה id וטוקן', JSON.stringify(created));
const { id, token } = created;

r = await fetch(`${base}/api/games/${id}`);
const got = await j(r);
ok(r.status === 200 && got.version === 1 && got.game.title === 'בדיקה', 'קריאת משחק ציבורית');
ok(!JSON.stringify(got).includes(token) && !('token_hash' in got), 'התשובה אינה חושפת טוקן או hash');

// --- אימות והרשאות
r = await fetch(`${base}/api/games/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game: game({ title: 'פריצה' }), baseVersion: 1 }) });
ok(r.status === 403, 'עדכון ללא טוקן נדחה', String(r.status));
r = await fetch(`${base}/api/games/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Edit-Token': 'wrong' }, body: JSON.stringify({ game: game({ title: 'פריצה' }), baseVersion: 1 }) });
ok(r.status === 403, 'עדכון עם טוקן שגוי נדחה', String(r.status));
r = await fetch(`${base}/api/games/${id}`, { method: 'DELETE' });
ok(r.status === 403, 'מחיקה ללא טוקן נדחית', String(r.status));
r = await fetch(`${base}/api/games/${id}/images/img00001`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: jpeg });
ok(r.status === 403, 'העלאת תמונה ללא טוקן נדחית', String(r.status));
r = await fetch(`${base}/api/games/${id}?edit=1`, { headers: { 'X-Edit-Token': 'wrong' } });
ok(r.status === 403, 'edit=1 עם טוקן שגוי נדחה', String(r.status));

// --- עדכון וגרסאות
const H = { 'Content-Type': 'application/json', 'X-Edit-Token': token };
r = await fetch(`${base}/api/games/${id}`, { method: 'PUT', headers: H, body: JSON.stringify({ game: game({ title: 'עודכן' }), baseVersion: 1 }) });
ok(r.status === 200 && (await j(r)).version === 2, 'עדכון עם טוקן מקדם גרסה');
r = await fetch(`${base}/api/games/${id}`, { method: 'PUT', headers: H, body: JSON.stringify({ game: game({ title: 'דריסה' }), baseVersion: 1 }) });
ok(r.status === 409, 'עדכון על גרסה ישנה נדחה (409)', String(r.status));
r = await fetch(`${base}/api/games/${id}`);
ok((await j(r)).game.title === 'עודכן', 'הגרסה הישנה לא דרסה');

// --- ולידציית משחק
r = await post({ game: game({ intro: { text: '', link: 'javascript:alert(1)' } }) });
ok(r.status === 400, 'קישור javascript: נדחה');
r = await post({ game: game({ intro: { text: '', link: 'http://insecure.example' } }) });
ok(r.status === 400, 'קישור http נדחה');
r = await post({ game: game({ stations: [] }) });
ok(r.status === 400, 'משחק בלי תחנות נדחה');
r = await post({ game: game({ stations: Array.from({ length: 26 }, (_, i) => ({ id: `st${String(i).padStart(6, '0')}`, name: 'x', content: '', submit: { text: false, photo: false, audio: false } })) }) });
ok(r.status === 400, 'יותר מ-25 תחנות נדחה');
r = await fetch(`${base}/api/games`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json' });
ok(r.status === 400, 'JSON שבור נדחה');
r = await post({ game: game({ stations: [{ id: 'st000001', name: '<img src=x onerror=alert(1)>', content: '<script>alert(1)</script>', submit: { text: false, photo: false, audio: false } }] }) });
const xss = await j(r);
r = await fetch(`${base}/api/games/${xss.id}`);
ok(r.headers.get('content-type')?.startsWith('application/json') && r.headers.get('x-content-type-options') === 'nosniff', 'טקסט זדוני נשמר כנתונים ומוגש כ-JSON (ה-UI מציג כטקסט)');
r = await fetch(`${base}/api/games`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game: game({ intro: { text: 'x'.repeat(250000) } }) }) });
ok(r.status === 413 || r.status === 400, 'בקשה גדולה נדחית', String(r.status));

// --- תמונות
r = await fetch(`${base}/api/games/${id}/images/img00001`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg', 'X-Edit-Token': token }, body: jpeg });
ok(r.status === 201, 'העלאת JPEG תקין');
r = await fetch(`${base}/api/games/${id}/images/img00002`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg', 'X-Edit-Token': token }, body: svg });
ok(r.status === 415, 'SVG שמוצג כ-image/jpeg נדחה לפי תוכן', String(r.status));
r = await fetch(`${base}/api/games/${id}/images/img00003`, { method: 'PUT', headers: { 'Content-Type': 'image/png', 'X-Edit-Token': token }, body: new TextEncoder().encode('<html>not an image</html>') });
ok(r.status === 415, 'HTML בשם תמונה נדחה');
r = await fetch(`${base}/api/games/${id}/images/img00004`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg', 'X-Edit-Token': token }, body: new Uint8Array(500 * 1024).fill(0xff) });
ok(r.status === 413 || r.status === 415, 'תמונה גדולה מדי נדחית', String(r.status));
r = await fetch(`${base}/api/games/${id}/images/img00001`);
ok(r.status === 200 && r.headers.get('content-type') === 'image/jpeg' && r.headers.get('x-content-type-options') === 'nosniff', 'קריאת תמונה עם סוג ו-nosniff');
r = await fetch(`${base}/api/games/${id}/images/..%2F..%2Fx`);
ok(r.status === 400 || r.status === 404, 'מזהה תמונה עם מעבר תיקיות נדחה', String(r.status));

// עדכון שמשמיט את התמונה מנקה אותה (img00001 לא מופיעה במשחק)
r = await fetch(`${base}/api/games/${id}`, { method: 'PUT', headers: H, body: JSON.stringify({ game: game({ title: 'עוד' }), baseVersion: 2 }) });
r = await fetch(`${base}/api/games/${id}/images/img00001`);
ok(r.status === 404, 'תמונה שאינה בשימוש נמחקת בעדכון', String(r.status));

// --- מחיקה
r = await fetch(`${base}/api/games/${id}`, { method: 'DELETE', headers: { 'X-Edit-Token': token } });
ok(r.status === 200, 'מחיקה עם טוקן');
r = await fetch(`${base}/api/games/${id}`);
ok(r.status === 404, 'משחק שנמחק אינו נגיש');
r = await fetch(`${base}/api/games/not-valid-id`);
ok(r.status === 404, 'מזהה משחק לא תקין → 404');

// --- הגבלת קצב (אופציונלי)
if (checkRate) {
  let limited = false;
  for (let i = 0; i < 15 && !limited; i++) limited = (await post({ game: game() })).status === 429;
  ok(limited, 'הגבלת קצב ליצירה מחזירה 429');
}

console.log(failed ? `\n${failed} בדיקות נכשלו` : '\nכל הבדיקות עברו');
process.exit(failed ? 1 : 0);
