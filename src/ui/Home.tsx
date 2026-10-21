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
      <div class="hero" aria-hidden="true">🗺️</div>
      <h1 class="center-text">חפש את המטמון</h1>
      <p class="lead center-text">בנו בעצמכם משחק חפש את המטמון לטלפונים של התלמידים — בלי תכנות ובלי הרשמה.</p>
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
    <main class="page prose help">
      <h1>איך משתמשים?</h1>
      <p class="lead">
        בונים משחק בכמה דקות, שולחים קישור לתלמידים, והם מסתובבים בין התחנות עם הטלפון. בסוף כל תלמיד או קבוצה מפיקים דוח ושולחים אותו אליכם.
      </p>

      <h2>בקצרה — חמישה צעדים</h2>
      <ol class="steps">
        <li><strong>בונים:</strong> נותנים שם, בוחרים סוג מסלול, כותבים מסך פתיחה ומוסיפים תחנות.</li>
        <li><strong>בודקים:</strong> "תצוגה מקדימה" מראה בדיוק מה התלמיד יראה. שום דבר לא נשמר בה.</li>
        <li><strong>מפרסמים:</strong> מקבלים <em>קישור לתלמידים</em> (שולחים בוואטסאפ) ו<em>קישור עריכה סודי</em> (שומרים לעצמכם!).</li>
        <li><strong>התלמידים משחקים</strong> בדפדפן של הטלפון, ובסוף לוחצים "סיימתי" ומפיקים דוח.</li>
        <li><strong>מקבלים דוח:</strong> התלמידים שולחים לכם את הדוח (PDF, ולפעמים גם קובצי הקלטה) בוואטסאפ או במייל.</li>
      </ol>

      <h2>מה לעשות בכל שלב בבנייה</h2>
      <div class="card">
        <h3>1. שם המשחק</h3>
        <p>השם מופיע בראש המסך אצל התלמידים ובראש הדוח.</p>
      </div>
      <div class="card">
        <h3>2. סוג המסלול — איך התלמידים עוברים בין התחנות</h3>
        <ul>
          <li><strong>מסלול קווי:</strong> התחנות לפי הסדר שקבעתם, מהראשונה לאחרונה. תחנה שעוד לא הגיעו אליה נעולה. התחנה האחרונה ברשימה היא תחנת הסיום. מתאים לסיפור שמתפתח או לחידה שבונה על הקודמת.</li>
          <li><strong>מסלול מעגלי:</strong> הסדר קבוע וחוזר על עצמו, אבל כל קבוצה בוחרת מאיפה להתחיל. כך אפשר לפזר קבוצות על פני התחנות כדי שלא כולן יעמדו באותו מקום.</li>
          <li><strong>תחנות חופשיות:</strong> אין סדר. התלמידים בוחרים בכל פעם לאיזו תחנה ללכת. מתאים לתחנות עצמאיות, למשל במוזיאון. רוצים "8 מתוך 10"? כתבו זאת במסך הפתיחה — המערכת לא אוכפת מכסה.</li>
        </ul>
      </div>
      <div class="card">
        <h3>3. מסך פתיחה</h3>
        <p>הטקסט הראשון שהתלמיד רואה: סיפור המסגרת, המשימה, וההוראות להתחלה ולהגשה. אפשר להוסיף תמונה וקישור חיצוני (למשל סרטון ב-YouTube).</p>
      </div>
      <div class="card">
        <h3>4. תחנות — מה קורה בכל תחנה</h3>
        <ul>
          <li><strong>שם התחנה:</strong> התלמידים רואים אותו. אם השם עלול לגלות את התשובה, תנו שם ניטרלי כמו "תחנה 3".</li>
          <li><strong>תוכן והוראות:</strong> החידה, ההסבר או המשימה. אפשר להוסיף תמונה וקישור.</li>
          <li><strong>מה להגיש:</strong> תשובה כתובה, צילום, הקלטת קול, או שילוב. אפשר גם לבחור "לא נדרש תוצר". התוצר נשמר בטלפון של התלמיד, מופיע בדוח, ולא נבדק על ידי המערכת — אתם קוראים אותו.</li>
          <li><strong>קוד מעבר (לא חובה):</strong> חידה קצרה עם תשובה קצרה וחד-משמעית. אפשר לתת כמה תשובות מקובלות (למשל "5" ו"חמש"). התלמיד שמקליד תשובה נכונה רואה "הקוד נכון" ואת הרמז שכתבתם. במסלול קווי הקוד נדרש כדי לפתוח את התחנה הבאה. במסלולים האחרים הוא רק חידה משחקית. הקוד הוא חלק מהמשחק ולא אבטחה.</li>
        </ul>
      </div>
      <div class="card">
        <h3>5. תצוגה מקדימה, פרסום ושמירה</h3>
        <ul>
          <li><strong>פרסום:</strong> יוצר קישור לתלמידים וקישור עריכה סודי. בלי הקישור הסודי אי אפשר לערוך את המשחק שפורסם, לכן שמרו אותו (למשל שלחו לעצמכם במייל).</li>
          <li><strong>שמור משחק לשימוש חוזר:</strong> יוצר קובץ במחשב עם כל המשחק והתמונות. בשנה הבאה לוחצים "פתח משחק ששמרתי", בוחרים את הקובץ ומפרסמים מחדש. אין צורך לפתוח את הקובץ בעצמכם.</li>
          <li><strong>שינוי משחק שפורסם:</strong> נכנסים בקישור העריכה ולוחצים "שמור שינויים". קישור התלמידים נשאר. תלמידים שכבר התחילו ממשיכים בגרסה שבה התחילו, ואלה שיפתחו מעכשיו יראו את החדשה.</li>
        </ul>
      </div>

      <h2>דוגמה לתחנה</h2>
      <div class="card">
        <p><strong>שם התחנה:</strong> תחנה 3</p>
        <p><strong>תוכן והוראות:</strong> "מצאו ליד הכניסה לספרייה את השעון הישן. כמה פעמים הוא מצלצל בצהריים? צלמו את השעון וכתבו את התשובה."</p>
        <p><strong>מה להגיש:</strong> תשובה כתובה + צילום</p>
        <p><strong>קוד מעבר:</strong> תשובות מתקבלות: "12" ו"שתים עשרה". רמז לאחר הצלחה: "התחנה הבאה ליד המעבדה."</p>
      </div>

      <h2>מה התלמידים עושים ומה מקבלים</h2>
      <ul>
        <li>פותחים את הקישור בכרום או בספארי (לא בתוך וואטסאפ, אם צילום או הקלטה לא עובדים).</li>
        <li>כותבים שם או שם קבוצה. הכול נשמר בטלפון שלהם בלבד.</li>
        <li>הכפתור "סיימתי" זמין בכל רגע, גם אם לא סיימו את כל התחנות.</li>
        <li>הדוח: קובץ PDF בעברית עם שם המשחק, השם, התאריך, ובכל תחנה מה שהוגש (כולל התמונות). הקלטות מגיעות כקבצים נפרדים לצד ה-PDF. הלחצן "שיתוף" שולח הכול יחד, למשל לוואטסאפ.</li>
      </ul>

      <h2>טיפים</h2>
      <ul>
        <li>קישורים חיצוניים (YouTube, מסמכים) חייבים להתחיל ב-https:// והם דורשים אינטרנט.</li>
        <li>אפשר להשתמש במשחק בשטח בית הספר, במוזיאון, בטבע, בסיור, ואפילו בכיתה.</li>
        <li>אל תבקשו מהתלמידים צילום של אנשים בלי אישור. הצילומים וההקלטות נשמרים בטלפון שלהם ומשותפים רק לפי הנחיותיכם.</li>
      </ul>

      <Link to="/" class="btn primary">
        חזרה לעמוד הבית
      </Link>
      <Credit />
    </main>
  );
}
