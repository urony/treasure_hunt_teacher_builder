import { Game, PublishedGame } from '../shared/types';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

async function call(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError('אין חיבור לאינטרנט. בדקו את החיבור ונסו שוב.', 0, 'network');
  }
  if (!res.ok) {
    let msg = 'משהו השתבש. נסו שוב בעוד רגע.';
    let code: string | undefined;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
      code = j?.code;
    } catch {
      /* ignore */
    }
    throw new ApiError(msg, res.status, code);
  }
  return res;
}

const authHeaders = (token: string) => ({ 'X-Edit-Token': token });

export async function fetchGame(id: string): Promise<PublishedGame> {
  const res = await call(`/api/games/${encodeURIComponent(id)}`, { cache: 'no-store' });
  return res.json();
}

export async function fetchImage(gameId: string, imageId: string): Promise<{ blob: Blob; mime: string }> {
  const res = await call(`/api/games/${encodeURIComponent(gameId)}/images/${encodeURIComponent(imageId)}`);
  const blob = await res.blob();
  return { blob, mime: res.headers.get('content-type') ?? blob.type };
}

export async function createGame(game: Game): Promise<{ id: string; token: string; version: number }> {
  const res = await call('/api/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ game }),
  });
  return res.json();
}

export async function updateGame(id: string, token: string, baseVersion: number, game: Game): Promise<{ version: number }> {
  const res = await call(`/api/games/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ game, baseVersion }),
  });
  return res.json();
}

export async function uploadImage(id: string, token: string, imageId: string, blob: Blob): Promise<void> {
  await call(`/api/games/${encodeURIComponent(id)}/images/${encodeURIComponent(imageId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': blob.type || 'application/octet-stream', ...authHeaders(token) },
    body: blob,
  });
}

export async function deleteGame(id: string, token: string): Promise<void> {
  await call(`/api/games/${encodeURIComponent(id)}`, { method: 'DELETE', headers: authHeaders(token) });
}

/** מחזיר את המשחק לעריכה (דורש טוקן) */
export async function fetchGameForEdit(id: string, token: string): Promise<PublishedGame> {
  const res = await call(`/api/games/${encodeURIComponent(id)}?edit=1`, { headers: authHeaders(token), cache: 'no-store' });
  return res.json();
}
