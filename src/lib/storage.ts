import { Game } from '../shared/types';
import { idbDel, idbDelPrefix, idbGet, idbPut } from './idb';

export interface BlobRec {
  blob: Blob;
  mime: string;
  ext: string;
}

export interface Submission {
  text: string;
  /** מפתחות blob של תמונות */
  photos: string[];
  /** מפתח blob של הקלטה */
  audio?: string;
}

export interface Progress {
  gameId: string;
  gameVersion: number;
  studentName: string;
  startedAt: number;
  phase: 'intro' | 'play' | 'finish';
  startingStationId?: string;
  currentStationId?: string;
  /** במסלול קווי: האינדקס הגבוה ביותר שנפתח */
  maxIndex: number;
  visited: string[];
  solved: string[];
  subs: Record<string, Submission>;
}

export interface SavedGame {
  game: Game;
  version: number;
}

/** כל מה שהנגן צריך כדי לשמור ולקרוא. יש מימוש אמיתי (IndexedDB) ומימוש זיכרון לתצוגה מקדימה. */
export interface PlayStore {
  loadProgress(): Promise<Progress | undefined>;
  saveProgress(p: Progress): Promise<void>;
  putBlob(key: string, rec: BlobRec): Promise<void>;
  getBlob(key: string): Promise<BlobRec | undefined>;
  deleteBlob(key: string): Promise<void>;
}

export const teacherImageKey = (gameId: string, imageId: string) => `t:${gameId}:${imageId}`;
export const studentBlobKey = (gameId: string, id: string) => `s:${gameId}:${id}`;
export const draftImageKey = (imageId: string) => `d:${imageId}`;

export function idbPlayStore(gameId: string): PlayStore {
  return {
    loadProgress: () => idbGet<Progress>('progress', gameId),
    saveProgress: (p) => idbPut('progress', gameId, p),
    putBlob: (k, r) => idbPut('blobs', k, r),
    getBlob: (k) => idbGet<BlobRec>('blobs', k),
    deleteBlob: (k) => idbDel('blobs', k),
  };
}

/** תצוגה מקדימה: שום דבר לא נשמר ב-IndexedDB; תמונות המורה נקראות מהטיוטה. */
export function memoryPlayStore(): PlayStore {
  const blobs = new Map<string, BlobRec>();
  let progress: Progress | undefined;
  return {
    loadProgress: async () => progress,
    saveProgress: async (p) => void (progress = p),
    putBlob: async (k, r) => void blobs.set(k, r),
    getBlob: async (k) => blobs.get(k) ?? (k.startsWith('d:') ? idbGet<BlobRec>('blobs', k) : undefined),
    deleteBlob: async (k) => void blobs.delete(k),
  };
}

export const loadSavedGame = (gameId: string) => idbGet<SavedGame>('games', gameId);
export const saveSavedGame = (gameId: string, g: SavedGame) => idbPut('games', gameId, g);

/** מוחק מהמכשיר את כל מה ששייך למשחק (התקדמות, עותק משחק, תמונות מורה, תוצרי תלמיד). */
export async function clearGameData(gameId: string): Promise<void> {
  await idbDel('progress', gameId);
  await idbDel('games', gameId);
  await idbDelPrefix('blobs', `t:${gameId}:`);
  await idbDelPrefix('blobs', `s:${gameId}:`);
}

export function mimeToExt(mime: string): string {
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'm4a';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('wav')) return 'wav';
  return 'bin';
}
