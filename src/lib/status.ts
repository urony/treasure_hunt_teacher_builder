import { Station } from '../shared/types';
import type { Submission } from './storage';

export type Outcome = 'notVisited' | 'notRequired' | 'missing' | 'partial' | 'full';

export function requiredKinds(s: Station): ('text' | 'photo' | 'audio')[] {
  const k: ('text' | 'photo' | 'audio')[] = [];
  if (s.submit.text) k.push('text');
  if (s.submit.photo) k.push('photo');
  if (s.submit.audio) k.push('audio');
  return k;
}

export function submittedKinds(sub: Submission | undefined): ('text' | 'photo' | 'audio')[] {
  const k: ('text' | 'photo' | 'audio')[] = [];
  if (sub?.text.trim()) k.push('text');
  if (sub && sub.photos.length > 0) k.push('photo');
  if (sub?.audio) k.push('audio');
  return k;
}

/** מצב תחנה לפי ההגדרות: לא נבדקת נכונות, רק מה הוגש. */
export function stationOutcome(s: Station, sub: Submission | undefined, visited: boolean): Outcome {
  if (!visited) return 'notVisited';
  const req = requiredKinds(s);
  if (req.length === 0) return 'notRequired';
  const got = submittedKinds(sub).filter((k) => req.includes(k));
  if (got.length === 0) return 'missing';
  return got.length === req.length ? 'full' : 'partial';
}

export const OUTCOME_TEXT: Record<Outcome, string> = {
  notVisited: 'לא בוצעה',
  notRequired: 'לא נדרש תוצר',
  missing: 'לא הוגש תוצר',
  partial: 'תוצר חלקי',
  full: 'הוגש',
};
