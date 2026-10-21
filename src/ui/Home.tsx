import { useEffect, useRef, useState } from 'preact/hooks';
import { importGameZip } from '../lib/gamezip';
import { idbPut } from '../lib/idb';
import { draftImageKey } from '../lib/storage';
import { Credit, Link, Modal, navigate } from './common';
import { discardDraft, loadDraft, saveDraft } from './Editor';

export function Home() {
  const [hasDraft, setHasDraft] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [importMsg, setImportMsg] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadDraft().then((d) => setHasDraft(!!d), () => {});
  }, []);

  async function openSaved(file: File) {
    if (hasDraft && !confirm('פתיחת המשחק תחליף את הטיוטה הקיימת. להמשיך?')) return;
    try {
      const imp = await importGameZip(file);
      await discardDraft();
      for (const [id, rec] of imp.images) await idbPut('blobs', draftImageKey(id), rec);
      await saveDraft({ game: imp.game, updatedAt: Date.now() });
      navigate('/edit');
    } catch (e) {
      setImportMsg((e as Error).message);
    }
  }

  return (
    <main class="page home">
      <h1>חפש את המטמון</h1>
      <p class="lead">בנו בעצמכם משחק חפש את המטמון לטלפונים של התלמידים — בלי תכנות ובלי הרשמה.</p>
      <div class="stack">
        {hasDraft && (
          <Link to="/edit" class="btn primary big">
            המשך עריכת טיוטה
          </Link>
        )}
        <button
          class={`btn big ${hasDraft ? 'secondary' : 'primary'}`}
          onClick={async () => {
            if (hasDraft) return setConfirmNew(true);
            navigate('/edit');
          }}
        >
          בנה משחק חדש
        </button>
        <button class="btn secondary big" onClick={() => fileRef.current?.click()}>
          פתח משחק ששמרתי
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (f) void openSaved(f);
          }}
        />
        {importMsg && <p class="banner err">{importMsg}</p>}
        <Link to="/help" class="btn link">
          איך משתמשים?
        </Link>
      </div>
      {confirmNew && (
        <Modal>
          <h2>להתחיל משחק חדש?</h2>
          <p>הטיוטה הקיימת במחשב הזה תימחק. אם רוצים לשמור אותה, חזרו אליה ולחצו "שמור משחק לשימוש חוזר".</p>
          <div class="row">
            <button class="btn secondary" onClick={() => setConfirmNew(false)}>
              חזרה
            </button>
            <button
              class="btn danger"
              onClick={async () => {
                await discardDraft();
                navigate('/edit');
              }}
            >
              כן, משחק חדש
            </button>
          </div>
        </Modal>
      )}
      <Credit />
    </main>
  );
}

export function Help() {
  return (
    <main class="page prose">
      <h1>איך משתמשים?</h1>
      <ol class="steps">
        <li>
          <strong>בונים:</strong> נותנים שם למשחק, בוחרים סוג מסלול, כותבים מסך פתיחה ומוסיפים תחנות.
        </li>
        <li>
          <strong>בודקים:</strong> "תצוגה מקדימה" מראה בדיוק מה התלמיד יראה.
        </li>
        <li>
          <strong>מפרסמים:</strong> מקבלים קישור לתלמידים (שולחים בוואטסאפ) וקישור עריכה סודי (שומרים לעצמכם!).
        </li>
        <li>
          <strong>התלמידים משחקים</strong> בדפדפן של הטלפון, מסתובבים בין התחנות ובסוף לוחצים "סיימתי" ומפיקים דוח PDF.
        </li>
        <li>
          <strong>מקבלים דוח:</strong> התלמידים שולחים לכם את הקובץ בוואטסאפ או במייל. שום דבר לא נשמר בשרת שלנו.
        </li>
      </ol>
      <h2>דוגמה לתחנה</h2>
      <div class="card">
        <p><strong>שם התחנה:</strong> תחנה 3</p>
        <p><strong>תוכן והוראות:</strong> "מצאו ליד הכניסה לספרייה את השעון הישן. כמה פעמים הוא מצלצל בצהריים? צלמו את השעון וכתבו את התשובה."</p>
        <p><strong>מה להגיש:</strong> תשובה כתובה + צילום</p>
        <p><strong>קוד מעבר:</strong> תשובות מתקבלות: "12" ו"שתים עשרה"</p>
      </div>
      <h2>טיפים</h2>
      <ul>
        <li>תלמיד יכול ללחוץ "סיימתי" בכל רגע, גם בלי להשלים את כל התחנות.</li>
        <li>קוד מעבר הוא חידה משחקית, לא הגנה. תלמיד טכני עשוי למצוא את התשובה בקובצי האתר.</li>
        <li>אם שיניתם משחק שפורסם, תלמידים שכבר התחילו ממשיכים בגרסה שבה התחילו.</li>
        <li>קישורים חיצוניים (YouTube, מסמכים) חייבים להתחיל ב-https:// והם דורשים אינטרנט.</li>
        <li>"שמור משחק לשימוש חוזר" יוצר קובץ במחשב, עם התמונות. אפשר לפתוח אותו שנה הבאה ולפרסם מחדש.</li>
      </ul>
      <Link to="/" class="btn primary">
        חזרה לעמוד הבית
      </Link>
      <Credit />
    </main>
  );
}
