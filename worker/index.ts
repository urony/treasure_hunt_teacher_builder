import { Game, LIMITS } from '../src/shared/types';
import { cleanGame, collectImageIds, isImageId, validateGame } from '../src/shared/validate';

interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  ASSETS: Fetcher;
  PUBLISH_DISABLED?: string;
}

const GAME_ID_RE = /^[a-z2-7]{10}$/;
const HOUR = 3600;
const RATE = { create: 10, upload: 150, update: 60 } as const; // לשעה לכל כתובת IP

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await route(request, env, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status);
      console.error(e);
      return json({ error: 'שגיאת שרת. נסו שוב בעוד רגע.' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const parts = url.pathname.split('/').filter(Boolean); // ['api','games',id,'images',imageId]
  const method = request.method;
  if (parts[1] !== 'games') throw new HttpError(404, 'לא נמצא');

  if (parts.length === 2) {
    if (method === 'POST') return createGame(request, env);
    throw new HttpError(405, 'שיטה לא נתמכת');
  }

  const id = parts[2];
  if (!GAME_ID_RE.test(id)) throw new HttpError(404, 'המשחק לא נמצא');

  if (parts.length === 3) {
    if (method === 'GET') return getGame(request, env, id, url);
    if (method === 'PUT') return updateGame(request, env, id);
    if (method === 'DELETE') return deleteGame(request, env, id);
    throw new HttpError(405, 'שיטה לא נתמכת');
  }

  if (parts.length === 5 && parts[3] === 'images') {
    const imageId = parts[4];
    if (!isImageId(imageId)) throw new HttpError(400, 'מזהה תמונה לא תקין');
    if (method === 'GET') return getImage(env, id, imageId);
    if (method === 'PUT') return putImage(request, env, id, imageId);
  }
  throw new HttpError(404, 'לא נמצא');
}

/* ---------- עזרים ---------- */

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function newGameId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => alphabet[b % 32]).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function readBody(request: Request, max: number): Promise<ArrayBuffer> {
  const len = Number(request.headers.get('content-length') ?? '0');
  if (len > max) throw new HttpError(413, 'הבקשה גדולה מדי.');
  const buf = await request.arrayBuffer();
  if (buf.byteLength > max) throw new HttpError(413, 'הבקשה גדולה מדי.');
  return buf;
}

async function readJson<T>(request: Request, max: number): Promise<T> {
  const buf = await readBody(request, max);
  try {
    return JSON.parse(new TextDecoder().decode(buf)) as T;
  } catch {
    throw new HttpError(400, 'הבקשה אינה תקינה.');
  }
}

function assertPublishEnabled(env: Env) {
  if (env.PUBLISH_DISABLED === 'true') {
    throw new HttpError(503, 'הפרסום וההעלאה מושבתים זמנית. משחקים קיימים ממשיכים לעבוד. נסו שוב מאוחר יותר.', 'publish_disabled');
  }
}

/** הגבלת קצב פשוטה (חלון קבוע של שעה) לפי hash של ה-IP. לא שומרים IP גלוי. */
async function rateLimit(env: Env, request: Request, action: keyof typeof RATE) {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const key = `${action}:${(await sha256Hex(ip)).slice(0, 24)}`;
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare('SELECT count, window_start FROM rate_limits WHERE key = ?').bind(key).first<{ count: number; window_start: number }>();
  if (!row || now - row.window_start >= HOUR) {
    await env.DB.prepare('INSERT OR REPLACE INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)').bind(key, now).run();
    return;
  }
  if (row.count >= RATE[action]) {
    throw new HttpError(429, 'בוצעו יותר מדי פעולות בזמן קצר. נסו שוב בעוד כשעה.', 'rate_limited');
  }
  await env.DB.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').bind(key).run();
}

interface Row {
  id: string;
  version: number;
  data: string;
  token_hash: string;
}

async function authorize(request: Request, env: Env, id: string): Promise<Row> {
  const row = await env.DB.prepare('SELECT id, version, data, token_hash FROM games WHERE id = ?').bind(id).first<Row>();
  if (!row) throw new HttpError(404, 'המשחק לא נמצא.');
  const token = request.headers.get('X-Edit-Token') ?? '';
  const hash = await sha256Hex(token);
  if (!token || !timingSafeEqual(hash, row.token_hash)) throw new HttpError(403, 'קישור העריכה אינו תקין.', 'bad_token');
  return row;
}

function parseGameBody(body: { game?: unknown }): Game {
  const errs = validateGame(body.game);
  if (errs.length) throw new HttpError(400, errs[0], 'invalid_game');
  const game = cleanGame(body.game as Game);
  if (collectImageIds(game).length > LIMITS.maxImagesPerGame) throw new HttpError(400, 'יותר מדי תמונות במשחק.');
  const serialized = JSON.stringify(game);
  if (serialized.length > LIMITS.maxGameJsonBytes) throw new HttpError(413, 'המשחק גדול מדי.');
  return game;
}

/* ---------- משחקים ---------- */

async function createGame(request: Request, env: Env): Promise<Response> {
  assertPublishEnabled(env);
  await rateLimit(env, request, 'create');
  const body = await readJson<{ game?: unknown }>(request, LIMITS.maxGameJsonBytes + 1024);
  const game = parseGameBody(body);
  const id = newGameId();
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await env.DB.prepare('INSERT INTO games (id, version, data, token_hash, created_at, updated_at) VALUES (?, 1, ?, ?, ?, ?)')
    .bind(id, JSON.stringify(game), await sha256Hex(token), now, now)
    .run();
  return json({ id, token, version: 1 }, 201);
}

async function getGame(request: Request, env: Env, id: string, url: URL): Promise<Response> {
  const row = await env.DB.prepare('SELECT id, version, data, token_hash FROM games WHERE id = ?').bind(id).first<Row>();
  if (!row) throw new HttpError(404, 'המשחק לא נמצא. בדקו שהקישור שלם.');
  if (url.searchParams.get('edit') === '1') await authorize(request, env, id);
  return json({ id: row.id, version: row.version, game: JSON.parse(row.data) });
}

async function updateGame(request: Request, env: Env, id: string): Promise<Response> {
  assertPublishEnabled(env);
  const row = await authorize(request, env, id);
  await rateLimit(env, request, 'update');
  const body = await readJson<{ game?: unknown; baseVersion?: number }>(request, LIMITS.maxGameJsonBytes + 1024);
  if (body.baseVersion !== row.version) {
    throw new HttpError(409, 'המשחק עודכן בלשונית או במכשיר אחר. טענו מחדש כדי לא לדרוס שינויים.', 'version_conflict');
  }
  const game = parseGameBody(body);
  const version = row.version + 1;
  const res = await env.DB.prepare('UPDATE games SET data = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?')
    .bind(JSON.stringify(game), version, Date.now(), id, row.version)
    .run();
  if (!res.meta.changes) throw new HttpError(409, 'המשחק עודכן בו זמנית ממקום אחר. טענו מחדש.', 'version_conflict');

  // מנקה תמונות שכבר אינן בשימוש
  const keep = new Set(collectImageIds(game).map((i) => `games/${id}/${i}`));
  const listed = await env.IMAGES.list({ prefix: `games/${id}/` });
  const stale = listed.objects.map((o) => o.key).filter((k) => !keep.has(k));
  if (stale.length) await env.IMAGES.delete(stale);
  return json({ version });
}

async function deleteGame(request: Request, env: Env, id: string): Promise<Response> {
  await authorize(request, env, id);
  let cursor: string | undefined;
  do {
    const listed = await env.IMAGES.list({ prefix: `games/${id}/`, cursor });
    if (listed.objects.length) await env.IMAGES.delete(listed.objects.map((o) => o.key));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  await env.DB.prepare('DELETE FROM games WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

/* ---------- תמונות ---------- */

function sniffImage(b: Uint8Array): string | null {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

async function putImage(request: Request, env: Env, id: string, imageId: string): Promise<Response> {
  assertPublishEnabled(env);
  await authorize(request, env, id);
  await rateLimit(env, request, 'upload');
  const buf = await readBody(request, LIMITS.maxImageBytes);
  const mime = sniffImage(new Uint8Array(buf)); // לפי תוכן הקובץ, לא לפי כותרת/סיומת
  if (!mime) throw new HttpError(415, 'הקובץ אינו תמונה נתמכת. אפשר JPEG, PNG או WebP.', 'bad_image');
  const key = `games/${id}/${imageId}`;
  if (await env.IMAGES.head(key)) return json({ ok: true, existed: true });
  const listed = await env.IMAGES.list({ prefix: `games/${id}/`, limit: LIMITS.maxImagesPerGame + 10 });
  if (listed.objects.length >= LIMITS.maxImagesPerGame + 5) throw new HttpError(400, 'יותר מדי תמונות במשחק.');
  await env.IMAGES.put(key, buf, { httpMetadata: { contentType: mime } });
  return json({ ok: true }, 201);
}

async function getImage(env: Env, id: string, imageId: string): Promise<Response> {
  const obj = await env.IMAGES.get(`games/${id}/${imageId}`);
  if (!obj) throw new HttpError(404, 'התמונה לא נמצאה.');
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Disposition': 'inline',
    },
  });
}
