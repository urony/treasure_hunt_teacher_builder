import { zipSync } from 'fflate';
import { Game } from '../shared/types';
import { buildPdf, PdfPage } from './pdf';
import { OUTCOME_TEXT, stationOutcome } from './status';
import { BlobRec, mimeToExt, Progress } from './storage';

const PAGE_W = 1240; // A4 ב-150dpi
const PAGE_H = 1754;
const MARGIN = 90;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FONT = '"Segoe UI", "Noto Sans Hebrew", "Arial Hebrew", Arial, Heebo, sans-serif';
const COLORS = { text: '#1b1b1b', muted: '#666', accent: '#0b5cad', line: '#cfd6dd' };
const MAX_IMG_H = 760;

export interface ReportResult {
  pdf: Blob;
  pages: number;
  audio: { name: string; blob: Blob }[];
  /** JPEG של העמוד הראשון — לבדיקה ויזואלית בעמוד ה-spike */
  firstPage?: Uint8Array;
}

export interface ReportInput {
  game: Game;
  progress: Pick<Progress, 'studentName' | 'visited' | 'subs'>;
  getBlob: (key: string) => Promise<BlobRec | undefined>;
  onProgress?: (message: string) => void;
  now?: Date;
}

/** מחלק טקסט לשורות לפי רוחב. מילים נשארות בסדר לוגי; הדפדפן מטפל ב-RTL בתוך כל שורה. */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  for (const para of text.replace(/\r/g, '').split('\n')) {
    if (!para.trim()) {
      lines.push('');
      continue;
    }
    let cur = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const trial = cur ? `${cur} ${word}` : word;
      if (ctx.measureText(trial).width <= maxW) {
        cur = trial;
        continue;
      }
      if (cur) lines.push(cur);
      // מילה ארוכה מדי לשורה: שוברים לפי תווים
      let chunk = '';
      for (const ch of word) {
        if (ctx.measureText(chunk + ch).width > maxW && chunk) {
          lines.push(chunk);
          chunk = ch;
        } else chunk += ch;
      }
      cur = chunk;
    }
    if (cur) lines.push(cur);
  }
  return lines;
}

class PageWriter {
  canvas = document.createElement('canvas');
  ctx: CanvasRenderingContext2D;
  y = MARGIN;
  pages: PdfPage[] = [];

  constructor() {
    this.canvas.width = PAGE_W;
    this.canvas.height = PAGE_H;
    this.ctx = this.canvas.getContext('2d')!;
    this.blank();
  }

  private blank() {
    this.ctx.fillStyle = '#fff';
    this.ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    this.ctx.direction = 'rtl';
    this.ctx.textAlign = 'right';
    this.ctx.textBaseline = 'alphabetic';
    this.y = MARGIN;
  }

  /** מסיים עמוד: מקודד ל-JPEG ומשחרר את הזיכרון של הקידוד לפני שממשיכים. */
  async flush(): Promise<void> {
    const blob = await new Promise<Blob>((res, rej) =>
      this.canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/jpeg', 0.85),
    );
    this.pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), width: PAGE_W, height: PAGE_H });
    this.blank();
  }

  async ensure(h: number) {
    if (this.y + h > PAGE_H - MARGIN && this.y > MARGIN) await this.flush();
  }

  async text(text: string, size: number, opts: { bold?: boolean; color?: string; gap?: number } = {}) {
    this.ctx.font = `${opts.bold ? 'bold ' : ''}${size}px ${FONT}`;
    this.ctx.fillStyle = opts.color ?? COLORS.text;
    const lh = Math.round(size * 1.45);
    for (const line of wrapText(this.ctx, text, CONTENT_W)) {
      await this.ensure(lh);
      this.ctx.font = `${opts.bold ? 'bold ' : ''}${size}px ${FONT}`;
      this.ctx.fillStyle = opts.color ?? COLORS.text;
      this.y += lh;
      this.ctx.fillText(line, PAGE_W - MARGIN, this.y);
    }
    this.y += opts.gap ?? 0;
  }

  async rule() {
    await this.ensure(30);
    this.ctx.strokeStyle = COLORS.line;
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(MARGIN, this.y + 12);
    this.ctx.lineTo(PAGE_W - MARGIN, this.y + 12);
    this.ctx.stroke();
    this.y += 30;
  }

  async image(blob: Blob) {
    let bmp: ImageBitmap | null = null;
    try {
      bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      const scale = Math.min(CONTENT_W / bmp.width, MAX_IMG_H / bmp.height, 1);
      const w = Math.round(bmp.width * scale);
      const h = Math.round(bmp.height * scale);
      await this.ensure(h + 20);
      this.ctx.drawImage(bmp, PAGE_W - MARGIN - w, this.y + 10, w, h);
      this.y += h + 30;
    } catch {
      await this.text('[לא ניתן להציג את התמונה]', 26, { color: COLORS.muted });
    } finally {
      bmp?.close();
    }
  }

  release() {
    this.canvas.width = this.canvas.height = 0;
  }
}

export async function buildReport(input: ReportInput): Promise<ReportResult> {
  const { game, progress, getBlob, onProgress } = input;
  if ('fonts' in document) await document.fonts.ready;
  const w = new PageWriter();
  const audio: ReportResult['audio'] = [];
  try {
    const date = (input.now ?? new Date()).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
    await w.text(game.title, 54, { bold: true, gap: 6 });
    await w.text(`שם התלמיד/הקבוצה: ${progress.studentName}`, 34, { gap: 2 });
    await w.text(`תאריך הפקת הדוח: ${date}`, 30, { color: COLORS.muted, gap: 6 });
    await w.rule();

    for (let i = 0; i < game.stations.length; i++) {
      const st = game.stations[i];
      onProgress?.(`מכינים את הדוח… תחנה ${i + 1} מתוך ${game.stations.length}`);
      const sub = progress.subs[st.id];
      const visited = progress.visited.includes(st.id);
      const outcome = stationOutcome(st, sub, visited);
      await w.ensure(140);
      await w.text(`${i + 1}. ${st.name}`, 38, { bold: true, color: COLORS.accent, gap: 4 });

      if (outcome === 'notVisited' || outcome === 'notRequired' || outcome === 'missing') {
        await w.text(OUTCOME_TEXT[outcome], 30, { color: COLORS.muted });
      } else {
        if (sub?.text.trim()) await w.text(sub.text.trim(), 30, { gap: 8 });
        for (const key of sub?.photos ?? []) {
          const rec = await getBlob(key);
          if (rec) await w.image(rec.blob);
          await yieldToUi();
        }
        if (sub?.audio) {
          const rec = await getBlob(sub.audio);
          if (rec) {
            const name = `station-${String(i + 1).padStart(2, '0')}.${rec.ext || mimeToExt(rec.mime)}`;
            audio.push({ name, blob: rec.blob });
            await w.text(`הקלטה מצורפת: ${name}`, 28, { color: COLORS.muted, gap: 4 });
          }
        }
        if (outcome === 'partial') await w.text('תוצר חלקי', 28, { bold: true, color: '#9a5b00' });
      }
      await w.text('', 14);
      await w.rule();
    }
    await w.flush();
    onProgress?.('מרכיבים את קובץ ה-PDF…');
    const pdf = buildPdf(w.pages);
    return { pdf, pages: w.pages.length, audio, firstPage: w.pages[0]?.jpeg };
  } finally {
    w.release();
  }
}

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

export interface PackagedReport {
  blob: Blob;
  fileName: string;
  mime: string;
  isZip: boolean;
}

/** PDF בלבד אם אין הקלטות; אחרת ZIP עם report.pdf וקובצי הקול. */
export async function packageReport(r: ReportResult, baseName: string): Promise<PackagedReport> {
  if (r.audio.length === 0) {
    return { blob: r.pdf, fileName: `${baseName}.pdf`, mime: 'application/pdf', isZip: false };
  }
  const files: Record<string, [Uint8Array, { level: 0 }]> = {
    'report.pdf': [new Uint8Array(await r.pdf.arrayBuffer()), { level: 0 }],
  };
  for (const a of r.audio) files[a.name] = [new Uint8Array(await a.blob.arrayBuffer()), { level: 0 }];
  const zipped = zipSync(files);
  return {
    blob: new Blob([zipped as BlobPart], { type: 'application/zip' }),
    fileName: `${baseName}.zip`,
    mime: 'application/zip',
    isZip: true,
  };
}
