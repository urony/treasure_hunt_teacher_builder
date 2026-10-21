import { useRef, useState } from 'preact/hooks';
import { idbDel, idbGet, idbPut, requestPersistence } from '../lib/idb';
import { compressImage } from '../lib/image';
import { buildReport, packageReport } from '../lib/report';
import { canShareFile, downloadBlob, looksLikeInAppBrowser, shareFile } from '../lib/share';
import { BlobRec } from '../lib/storage';
import { Game } from '../shared/types';

/**
 * עמוד בדיקת היתכנות (/spike). רץ בדפדפן של המכשיר הנבדק ומציג תוצאה לכל יכולת.
 * ✅/❌ מגיעים רק מהרצה בפועל. יכולות שתלויות בהרשאה/במשתמש (צילום, מיקרופון, שיתוף) מסומנות "דורש לחיצה".
 * התוצאות מוצגות גם כטקסט להעתקה כדי להדביק ב-spike-results/.
 */
type Result = { name: string; ok: boolean | null; detail: string };

const HEB_TEXT = 'שלום עולם! זהו מבחן עברית עם English בתוך המשפט ומספרים 12345 (בסוגריים). ' + 'אבגדהוזחטיכלמנסעפצקרשת — ךםןףץ.';

function syntheticImage(n: number): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = 3000;
  c.height = 2000;
  const ctx = c.getContext('2d')!;
  // רעש כדי שה-JPEG לא יהיה קטן מדי (מדמה צילום אמיתי)
  for (let y = 0; y < c.height; y += 8) {
    for (let x = 0; x < c.width; x += 8) {
      ctx.fillStyle = `hsl(${(x / 8 + y / 8 + n * 40) % 360},${60 + ((x * y) % 30)}%,${40 + ((x + y) % 30)}%)`;
      ctx.fillRect(x, y, 8, 8);
    }
  }
  return new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.92));
}

export function Spike() {
  const [results, setResults] = useState<Result[]>([]);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string>();
  const photoRef = useRef<HTMLInputElement>(null);
  const lastPackaged = useRef<Awaited<ReturnType<typeof packageReport>> | undefined>(undefined);

  const add = (r: Result) => setResults((x) => [...x.filter((y) => y.name !== r.name), r]);

  async function runAuto() {
    setRunning(true);
    setResults([]);
    add({ name: 'דפדפן', ok: null, detail: navigator.userAgent + (looksLikeInAppBrowser() ? ' — נראה כדפדפן פנימי!' : '') });

    // IndexedDB
    try {
      const blob = new Blob([new Uint8Array(2 * 1024 * 1024)], { type: 'application/octet-stream' });
      await idbPut('blobs', 'spike:test', { blob, mime: 'x', ext: 'bin' });
      const back = await idbGet<BlobRec>('blobs', 'spike:test');
      await idbDel('blobs', 'spike:test');
      add({ name: 'IndexedDB: שמירת Blob של 2MB וקריאה', ok: back?.blob.size === blob.size, detail: `גודל חזר: ${back?.blob.size}` });
    } catch (e) {
      add({ name: 'IndexedDB: שמירת Blob', ok: false, detail: String(e) });
    }
    add({ name: 'navigator.storage.persist()', ok: null, detail: (await requestPersistence()) ? 'ניתן' : 'לא ניתן/לא נתמך (לא קריטי)' });

    // כיווץ תמונה
    try {
      const big = await syntheticImage(0);
      const t = performance.now();
      const small = await compressImage(big);
      add({ name: 'כיווץ תמונה 3000x2000', ok: small.size < 400 * 1024, detail: `${(big.size / 1024) | 0}KB → ${(small.size / 1024) | 0}KB ב-${(performance.now() - t) | 0}ms` });
    } catch (e) {
      add({ name: 'כיווץ תמונה', ok: false, detail: String(e) });
    }

    // PDF עברי קצר
    try {
      const game: Game = {
        schemaVersion: 1,
        title: 'בדיקת PDF בעברית',
        routeType: 'free',
        intro: { text: '' },
        stations: [{ id: 'st1', name: 'תחנה 1 — Hebrew & English', content: '', submit: { text: true, photo: false, audio: false } }],
      };
      const r = await buildReport({
        game,
        progress: { studentName: 'קבוצה א׳ (Team A)', visited: ['st1'], subs: { st1: { text: HEB_TEXT, photos: [] } } },
        getBlob: async () => undefined,
      });
      const bytes = new Uint8Array(await r.pdf.arrayBuffer());
      const head = new TextDecoder().decode(bytes.slice(0, 8));
      add({ name: 'PDF עברי: נוצר', ok: head.startsWith('%PDF-'), detail: `${r.pages} עמוד, ${(r.pdf.size / 1024) | 0}KB. ⚠ קריאות העברית דורשת בדיקה ויזואלית — לחצו "הורד PDF" ופתחו.` });
      lastPackaged.current = await packageReport(r, 'spike-hebrew');
      if (r.firstPage) setPreviewUrl(URL.createObjectURL(new Blob([r.firstPage as BlobPart], { type: 'image/jpeg' })));
    } catch (e) {
      add({ name: 'PDF עברי', ok: false, detail: String(e) });
    }

    // PDF ארוך עם הרבה תמונות (עומס זיכרון)
    try {
      const stations = Array.from({ length: 25 }, (_, i) => ({
        id: `s${i}abcd`,
        name: `תחנה ${i + 1}`,
        content: '',
        submit: { text: true, photo: true, audio: false },
      }));
      const game: Game = { schemaVersion: 1, title: 'מבחן עומס', routeType: 'free', intro: { text: '' }, stations };
      const blobs = new Map<string, BlobRec>();
      const subs: Record<string, { text: string; photos: string[] }> = {};
      // 3 תמונות מכווצות (כמו תמונות תלמיד אמיתיות) בשימוש חוזר; הדוח מפענח כל אחת מחדש בכל תחנה
      const samples = await Promise.all([0, 1, 2].map(async (k) => compressImage(await syntheticImage(k))));
      for (const s of stations) {
        const keys: string[] = [];
        for (let k = 0; k < 3; k++) {
          const key = `${s.id}-${k}`;
          blobs.set(key, { blob: samples[k], mime: 'image/jpeg', ext: 'jpg' });
          keys.push(key);
        }
        subs[s.id] = { text: HEB_TEXT.repeat(3), photos: keys };
      }
      const t = performance.now();
      const mem0 = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
      const r = await buildReport({
        game,
        progress: { studentName: 'עומס', visited: stations.map((s) => s.id), subs },
        getBlob: async (k) => blobs.get(k),
        onProgress: (m) => setLog(m),
      });
      const mem1 = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
      add({
        name: 'PDF ארוך: 25 תחנות × 3 תמונות',
        ok: r.pdf.size > 0,
        detail: `${r.pages} עמודים, ${(r.pdf.size / 1024 / 1024).toFixed(1)}MB, ${((performance.now() - t) / 1000).toFixed(1)} שנ׳${mem0 && mem1 ? `, זיכרון JS ${(mem0 / 1e6) | 0}→${(mem1 / 1e6) | 0}MB` : ''}`,
      });
    } catch (e) {
      add({ name: 'PDF ארוך', ok: false, detail: String(e) });
    }

    // ZIP
    try {
      const pdf = new Blob([new Uint8Array(1000)], { type: 'application/pdf' });
      const z = await packageReport({ pdf, pages: 1, audio: [{ name: 'station-01.m4a', blob: new Blob([new Uint8Array(5000)]) }] }, 'zip-test');
      add({ name: 'ZIP: PDF + הקלטה', ok: z.isZip && z.blob.size > 6000, detail: `${z.blob.size} בייט` });
    } catch (e) {
      add({ name: 'ZIP', ok: false, detail: String(e) });
    }

    // יכולות דפדפן
    add({ name: 'MediaRecorder', ok: typeof MediaRecorder !== 'undefined', detail: typeof MediaRecorder !== 'undefined' ? ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].map((m) => `${m}:${MediaRecorder.isTypeSupported(m)}`).join(' ') : 'לא קיים' });
    const f = new File([new Blob(['x'])], 'x.pdf', { type: 'application/pdf' });
    add({ name: 'Web Share עם קבצים (canShare)', ok: null, detail: String(navigator.canShare?.({ files: [f] }) ?? 'לא נתמך') + ' (לא נתמך = fallback להורדה, תקין)' });

    for (const name of ['צילום מהמצלמה (לחיצה על "בדוק צילום")', 'הקלטה בפועל (לחיצה על "בדוק הקלטה")', 'הורדת PDF (לחיצה על "הורד PDF")', 'שיתוף בפועל (לחיצה על "בדוק שיתוף")', 'פתיחה מקישור בוואטסאפ']) {
      add({ name, ok: null, detail: 'לא נבדק — דורש פעולה ידנית במכשיר' });
    }
    setRunning(false);
  }

  async function testRecord() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m))!;
      const rec = new MediaRecorder(s, { mimeType: mime });
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        s.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: mime.split(';')[0] });
        const a = document.createElement('audio');
        const canPlay = a.canPlayType(blob.type);
        add({ name: 'הקלטה בפועל (לחיצה על "בדוק הקלטה")', ok: blob.size > 0, detail: `${mime}, ${blob.size} בייט, canPlayType="${canPlay}". יש להשמיע ידנית לאימות.` });
        const url = URL.createObjectURL(blob);
        const el = document.getElementById('spike-audio') as HTMLAudioElement;
        el.src = url;
      };
      rec.start();
      setTimeout(() => rec.stop(), 3000);
      setLog('מקליטים 3 שניות…');
    } catch (e) {
      add({ name: 'הקלטה בפועל (לחיצה על "בדוק הקלטה")', ok: false, detail: String(e) });
    }
  }

  const text = results.map((r) => `${r.ok === true ? 'PASS' : r.ok === false ? 'FAIL' : 'לא נבדק/ידני'} | ${r.name} | ${r.detail}`).join('\n');

  return (
    <main class="page">
      <h1>בדיקת היתכנות</h1>
      <p class="hint">הריצו בכל מכשיר ודפדפן (Android Chrome, iPhone Safari, וגם דרך קישור בוואטסאפ). אל תסתמכו על ✅ אם לא בדקתם את הפלט הוויזואלי.</p>
      <div class="stack">
        <button class="btn primary big" disabled={running} onClick={runAuto}>
          הרצת הבדיקות האוטומטיות
        </button>
        <button class="btn secondary" onClick={testRecord}>בדוק הקלטה</button>
        <audio id="spike-audio" controls class="audio" />
        <button class="btn secondary" onClick={() => photoRef.current?.click()}>בדוק צילום</button>
        <input
          ref={photoRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={async (e) => {
            const file = e.currentTarget.files?.[0];
            if (!file) return;
            try {
              const out = await compressImage(file);
              add({ name: 'צילום מהמצלמה (לחיצה על "בדוק צילום")', ok: true, detail: `${file.type} ${(file.size / 1024) | 0}KB → ${(out.size / 1024) | 0}KB` });
            } catch (err) {
              add({ name: 'צילום מהמצלמה (לחיצה על "בדוק צילום")', ok: false, detail: String(err) });
            }
          }}
        />
        <button
          class="btn secondary"
          onClick={() => {
            const p = lastPackaged.current;
            if (!p) return setLog('קודם הריצו את הבדיקות האוטומטיות');
            downloadBlob(p.blob, p.fileName);
            add({ name: 'הורדת PDF (לחיצה על "הורד PDF")', ok: null, detail: 'הופעלה הורדה — יש לוודא ידנית שהקובץ נשמר ונפתח, והעברית קריאה' });
          }}
        >
          הורד PDF
        </button>
        <button
          class="btn secondary"
          onClick={async () => {
            const p = lastPackaged.current;
            if (!p) return setLog('קודם הריצו את הבדיקות האוטומטיות');
            if (!canShareFile(p.blob, p.fileName, p.mime)) return add({ name: 'שיתוף בפועל (לחיצה על "בדוק שיתוף")', ok: false, detail: 'canShare=false → fallback להורדה' });
            try {
              const ok = await shareFile(p.blob, p.fileName, p.mime, 'spike');
              add({ name: 'שיתוף בפועל (לחיצה על "בדוק שיתוף")', ok: ok ? true : null, detail: ok ? 'נפתח חלון שיתוף' : 'בוטל על ידי המשתמש' });
            } catch (err) {
              add({ name: 'שיתוף בפועל (לחיצה על "בדוק שיתוף")', ok: false, detail: String(err) });
            }
          }}
        >
          בדוק שיתוף
        </button>
      </div>
      {log && <p class="hint">{log}</p>}
      <ul class="spike-list">
        {results.map((r) => (
          <li key={r.name} class={r.ok === true ? 'pass' : r.ok === false ? 'fail' : 'manual'}>
            <strong>{r.ok === true ? '✅' : r.ok === false ? '❌' : '❔'} {r.name}</strong>
            <div dir="auto">{r.detail}</div>
          </li>
        ))}
      </ul>
      {previewUrl && <img src={previewUrl} alt="עמוד ראשון של הדוח העברי" style="width:100%;border:1px solid #888" />}
      <textarea readOnly rows={8} dir="auto" value={text} onFocus={(e) => (e.target as HTMLTextAreaElement).select()} />
    </main>
  );
}
