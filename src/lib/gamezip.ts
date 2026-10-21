import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { Game, LIMITS, SCHEMA_VERSION } from '../shared/types';
import { collectImageIds, validateGame } from '../shared/validate';
import { BlobRec, mimeToExt } from './storage';

/** "שמור משחק לשימוש חוזר": ZIP עם game.json וכל תמונות המורה. אין בו טוקן עריכה. */
export async function exportGameZip(game: Game, getImage: (imageId: string) => Promise<BlobRec | undefined>): Promise<Blob> {
  const files: Record<string, Uint8Array> = {};
  const images: Record<string, string> = {};
  for (const id of collectImageIds(game)) {
    const rec = await getImage(id);
    if (!rec) continue;
    const name = `images/${id}.${rec.ext || mimeToExt(rec.mime)}`;
    files[name] = new Uint8Array(await rec.blob.arrayBuffer());
    images[id] = name;
  }
  files['game.json'] = strToU8(JSON.stringify({ schemaVersion: SCHEMA_VERSION, game, images }, null, 2));
  return new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: 'application/zip' });
}

export interface ImportedGame {
  game: Game;
  images: Map<string, BlobRec>;
  warnings: string[];
}

const MAX_ZIP_BYTES = 40 * 1024 * 1024;

export async function importGameZip(file: Blob): Promise<ImportedGame> {
  if (file.size > MAX_ZIP_BYTES) throw new Error('הקובץ גדול מדי.');
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (f) => f.originalSize <= 2 * 1024 * 1024 && (f.name === 'game.json' || f.name.startsWith('images/')),
    });
  } catch {
    throw new Error('זה לא נראה כמו קובץ משחק ששמרתי. בחרו קובץ ZIP שנשמר מהאתר.');
  }
  const raw = entries['game.json'];
  if (!raw) throw new Error('בקובץ חסר game.json — זה לא קובץ משחק של האתר.');
  let parsed: { schemaVersion?: number; game?: Game; images?: Record<string, string> };
  try {
    parsed = JSON.parse(strFromU8(raw));
  } catch {
    throw new Error('קובץ המשחק פגום.');
  }
  if (parsed.schemaVersion !== SCHEMA_VERSION) throw new Error('גרסת הקובץ אינה נתמכת.');
  const game = parsed.game as Game;
  const errs = validateGame(game);
  if (errs.length) throw new Error('קובץ המשחק אינו תקין: ' + errs[0]);

  const images = new Map<string, BlobRec>();
  const warnings: string[] = [];
  const drop = (id: string) => {
    if (game.intro.imageId === id) game.intro.imageId = undefined;
    for (const s of game.stations) if (s.imageId === id) s.imageId = undefined;
  };
  for (const id of collectImageIds(game)) {
    const name = parsed.images?.[id];
    const data = name && name.startsWith('images/') ? entries[name] : undefined;
    const mime = name ? mimeFromName(name) : '';
    if (!data || !mime || data.length > LIMITS.maxImageBytes * 2) {
      warnings.push('חלק מהתמונות חסרות בקובץ ולא נטענו.');
      drop(id);
      continue;
    }
    images.set(id, { blob: new Blob([data as BlobPart], { type: mime }), mime, ext: mimeToExt(mime) });
  }
  return { game, images, warnings: [...new Set(warnings)] };
}

function mimeFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return '';
}
