import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ApiError, createGame, deleteGame, fetchGameForEdit, fetchImage, updateGame, uploadImage } from '../lib/api';
import { exportGameZip, importGameZip } from '../lib/gamezip';
import { downloadBlob } from '../lib/share';
import { idbDel, idbDelPrefix, idbGet, idbPut } from '../lib/idb';
import { safeFileName, uid } from '../lib/ids';
import { compressImage } from '../lib/image';
import { BlobRec, draftImageKey, memoryPlayStore, mimeToExt, Progress } from '../lib/storage';
import { Game, LIMITS, ROUTE_LABELS, RouteType, SCHEMA_VERSION, Station } from '../shared/types';
import { cleanGame, collectImageIds, validateGame } from '../shared/validate';
import { BlobImg, CopyButton, Credit, Info, Link, Modal, navigate } from './common';
import { PlayGame } from './Player';

/* ---------- טיוטה מקומית ---------- */

interface Editing {
  id: string;
  token: string;
  version: number;
  /** תמונות שכבר הועלו לשרת */
  serverImages: string[];
}

interface Draft {
  game: Game;
  editing?: Editing;
  updatedAt: number;
}

export const newStation = (): Station => ({
  id: uid().replace(/-/g, '').slice(0, 12),
  name: '',
  content: '',
  submit: { text: false, photo: false, audio: false },
});

export const emptyGame = (): Game => ({
  schemaVersion: SCHEMA_VERSION,
  title: '',
  routeType: 'linear',
  intro: { text: '' },
  stations: [newStation()],
});

export const loadDraft = () => idbGet<Draft>('draft', 'current');
export const saveDraft = (d: Draft) => idbPut('draft', 'current', d);

export async function discardDraft() {
  await idbDel('draft', 'current');
  await idbDelPrefix('blobs', 'd:');
}

const draftGetBlob = (key: string) => idbGet<BlobRec>('blobs', key);

/* ---------- העורך ---------- */

/** remoteId: אם הגיעו דרך קישור עריכה /e/:id (הטוקן בחלק ה-# של הכתובת) */
export function Editor({ remoteId }: { remoteId?: string }) {
  const [game, setGame] = useState<Game>();
  const [editing, setEditing] = useState<Editing>();
  const [status, setStatus] = useState<{ kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; msg: string }>({ kind: 'loading' });
  const [openId, setOpenId] = useState<string>();
  const [errors, setErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [published, setPublished] = useState<{ id: string; token: string; updated: boolean }>();
  const [notice, setNotice] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [conflict, setConflict] = useState(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const importRef = useRef<HTMLInputElement>(null);

  /* טעינה */
  useEffect(() => {
    (async () => {
      try {
        if (remoteId) {
          const token = location.hash.slice(1);
          const draft = await loadDraft();
          const sameGame = draft?.editing?.id === remoteId && (!token || draft.editing.token === token);
          if (sameGame && draft) {
            setGame(draft.game);
            setEditing(draft.editing);
          } else {
            const t = token || draft?.editing?.token;
            if (!t) return setStatus({ kind: 'error', msg: 'חסר קוד סודי בקישור העריכה. פתחו את הקישור המלא כפי ששמרתם אותו.' });
            const pub = await fetchGameForEdit(remoteId, t);
            await discardDraft();
            const ids = collectImageIds(pub.game);
            for (const imageId of ids) {
              const { blob, mime } = await fetchImage(remoteId, imageId);
              await idbPut('blobs', draftImageKey(imageId), { blob, mime, ext: mimeToExt(mime) });
            }
            const ed: Editing = { id: remoteId, token: t, version: pub.version, serverImages: ids };
            await saveDraft({ game: pub.game, editing: ed, updatedAt: Date.now() });
            setGame(pub.game);
            setEditing(ed);
          }
        } else {
          const draft = await loadDraft();
          if (draft) {
            setGame(draft.game);
            setEditing(draft.editing);
          } else setGame(emptyGame());
        }
        setStatus({ kind: 'ready' });
      } catch (e) {
        setStatus({ kind: 'error', msg: (e as Error).message });
      }
    })();
  }, [remoteId]);

  /* שמירה אוטומטית של הטיוטה */
  const dirty = useRef(false);
  const persist = (g: Game, ed: Editing | undefined) => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveDraft({ game: g, editing: ed, updatedAt: Date.now() }).catch(() => setNotice('לא הצלחנו לשמור טיוטה במכשיר.'));
    }, 400);
  };
  const change = (fn: (g: Game) => Game) => {
    setGame((g) => {
      const next = fn(g!);
      dirty.current = true;
      persist(next, editing);
      return next;
    });
    setErrors([]);
  };
  const changeEditing = (ed: Editing) => {
    setEditing(ed);
    if (game) saveDraft({ game, editing: ed, updatedAt: Date.now() }).catch(() => {});
  };

  if (status.kind === 'loading' || !game) return <main class="page center"><p class="spinner-text">טוענים…</p></main>;
  if (status.kind === 'error') {
    return (
      <main class="page center">
        <h1>לא הצלחנו לפתוח</h1>
        <p class="banner err">{status.msg}</p>
        <Link to="/" class="btn primary">לעמוד הבית</Link>
      </main>
    );
  }

  /* ---------- פעולות ---------- */

  const setStation = (id: string, fn: (s: Station) => Station) => change((g) => ({ ...g, stations: g.stations.map((s) => (s.id === id ? fn(s) : s)) }));

  const move = (i: number, d: -1 | 1) =>
    change((g) => {
      const st = [...g.stations];
      const j = i + d;
      if (j < 0 || j >= st.length) return g;
      [st[i], st[j]] = [st[j], st[i]];
      return { ...g, stations: st };
    });

  const addStation = () => {
    if (game.stations.length >= LIMITS.maxStations) return setNotice(`אפשר עד ${LIMITS.maxStations} תחנות.`);
    const s = newStation();
    change((g) => ({ ...g, stations: [...g.stations, s] }));
    setOpenId(s.id);
  };

  const removeStation = (id: string) => {
    if (!confirm('למחוק את התחנה?')) return;
    change((g) => ({ ...g, stations: g.stations.filter((s) => s.id !== id) }));
  };

  async function pickImage(file: File | undefined, apply: (imageId: string | undefined) => void, prevId?: string) {
    if (!file) return;
    setNotice(undefined);
    try {
      const blob = await compressImage(file);
      const imageId = uid();
      await idbPut('blobs', draftImageKey(imageId), { blob, mime: 'image/jpeg', ext: 'jpg' });
      if (prevId) await idbDel('blobs', draftImageKey(prevId)).catch(() => {});
      apply(imageId);
    } catch (e) {
      setNotice((e as Error).message);
    }
  }

  const validated = (): Game | null => {
    const clean = cleanGame(game);
    const errs = validateGame(clean);
    setErrors(errs);
    return errs.length ? null : clean;
  };

  async function onPreview() {
    if (!validated()) return;
    setPreview(true);
  }

  async function onSaveFile() {
    const clean = validated();
    if (!clean) return;
    try {
      const blob = await exportGameZip(clean, (id) => draftGetBlob(draftImageKey(id)));
      downloadBlob(blob, `משחק ${safeFileName(clean.title, 'חפש את המטמון')}.zip`);
      setNotice('הקובץ ירד למחשב. אפשר לפתוח אותו בעתיד דרך "פתח משחק ששמרתי".');
    } catch {
      setNotice('לא הצלחנו ליצור את הקובץ.');
    }
  }

  async function onImport(file: File | undefined) {
    if (!file) return;
    if (!confirm('פתיחת המשחק תחליף את הטיוטה הנוכחית. להמשיך?')) return;
    try {
      const imp = await importGameZip(file);
      await discardDraft();
      for (const [id, rec] of imp.images) await idbPut('blobs', draftImageKey(id), rec);
      setEditing(undefined);
      setGame(imp.game);
      await saveDraft({ game: imp.game, updatedAt: Date.now() });
      setNotice(imp.warnings[0] ?? 'המשחק נפתח לעריכה. כדי להפיץ אותו, לחצו "פרסם משחק".');
      if (remoteId) navigate('/edit', true);
    } catch (e) {
      setNotice((e as Error).message);
    }
  }

  async function onPublish() {
    const clean = validated();
    if (!clean) return;
    setBusy('מפרסמים…');
    setNotice(undefined);
    let ed = editing;
    try {
      if (!ed) {
        const res = await createGame(clean);
        ed = { id: res.id, token: res.token, version: res.version, serverImages: [] };
        changeEditing(ed);
      }
      const created = !editing;
      // מעלים רק תמונות שעוד לא בשרת
      const uploaded = [...ed.serverImages];
      for (const imageId of collectImageIds(clean)) {
        if (uploaded.includes(imageId)) continue;
        const rec = await draftGetBlob(draftImageKey(imageId));
        if (!rec) throw new Error('אחת התמונות חסרה במכשיר. הסירו אותה והעלו מחדש.');
        setBusy('מעלים תמונות…');
        await uploadImage(ed.id, ed.token, imageId, rec.blob);
        uploaded.push(imageId);
      }
      let version = ed.version;
      if (!created) {
        setBusy('שומרים שינויים…');
        const r = await updateGame(ed.id, ed.token, ed.version, clean);
        version = r.version;
      }
      const next = { ...ed, version, serverImages: uploaded };
      setEditing(next);
      await saveDraft({ game: clean, editing: next, updatedAt: Date.now() });
      setPublished({ id: next.id, token: next.token, updated: !created });
      if (remoteId === undefined) history.replaceState(null, '', `/e/${next.id}#${next.token}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'version_conflict') setConflict(true);
      else setNotice((e as Error).message);
      if (ed && !editing) changeEditing(ed); // יצירה הצליחה אבל העלאה נכשלה: אפשר לנסות שוב
    } finally {
      setBusy(undefined);
    }
  }

  async function onDelete() {
    if (!editing) return;
    try {
      await deleteGame(editing.id, editing.token);
      await discardDraft();
      navigate('/');
    } catch (e) {
      setNotice((e as Error).message);
      setConfirmDelete(false);
    }
  }

  /* ---------- תצוגה מקדימה ---------- */
  if (preview) {
    const clean = cleanGame(game);
    const initial: Progress = {
      gameId: 'preview',
      gameVersion: 0,
      studentName: 'תצוגה מקדימה',
      startedAt: Date.now(),
      phase: 'intro',
      maxIndex: 0,
      visited: [],
      solved: [],
      subs: {},
    };
    return (
      <div>
        <div class="preview-bar">
          <span>תצוגה מקדימה — כך התלמידים יראו את המשחק. שום דבר לא נשמר.</span>
          <button class="btn secondary" onClick={() => setPreview(false)}>
            חזרה לעריכה
          </button>
        </div>
        <PlayGame key={Date.now()} game={clean} initial={initial} store={memoryPlayStore()} imageKey={draftImageKey} preview />
      </div>
    );
  }

  /* ---------- הודעת פרסום ---------- */
  if (published) {
    const origin = location.origin;
    const studentUrl = `${origin}/g/${published.id}`;
    const editUrl = `${origin}/e/${published.id}#${published.token}`;
    return (
      <main class="page">
        <h1>{published.updated ? 'השינויים נשמרו ✓' : 'המשחק פורסם ✓'}</h1>
        <div class="card">
          <h2>קישור לתלמידים</h2>
          <p class="hint">שולחים לתלמידים, למשל בוואטסאפ. {published.updated && 'הקישור לא השתנה. שינויים יופיעו אצל תלמידים שפותחים את המשחק מעכשיו; מי שכבר התחיל ממשיך בגרסה שבה התחיל.'}</p>
          <input class="link-box" readOnly value={studentUrl} onFocus={(e) => (e.target as HTMLInputElement).select()} />
          <CopyButton text={studentUrl} label="העתק קישור" />
        </div>
        <div class="card secret">
          <h2>קישור עריכה — סודי, לשמור לעצמכם</h2>
          <p>
            <strong>שמרו את קישור העריכה במקום בטוח</strong> (למשל שלחו אותו לעצמכם במייל). בלעדיו לא ניתן לערוך את המשחק בענן. אל תשלחו אותו לתלמידים.
          </p>
          <input class="link-box" readOnly value={editUrl} onFocus={(e) => (e.target as HTMLInputElement).select()} />
          <CopyButton text={editUrl} label="העתק קישור עריכה" />
          <p class="hint">אם הקישור יאבד, אפשר להשתמש ב"שמור משחק לשימוש חוזר" ולפרסם אותו כמשחק חדש עם קישורים חדשים.</p>
        </div>
        <div class="row">
          <button class="btn secondary" onClick={() => setPublished(undefined)}>
            חזרה לעריכה
          </button>
          <Link to="/" class="btn secondary">לעמוד הבית</Link>
        </div>
        <Credit />
      </main>
    );
  }

  /* ---------- מסך העריכה ---------- */
  return (
    <main class="page editor">
      <header class="row between">
        <h1>{editing ? 'עריכת משחק' : 'בניית משחק'}</h1>
        <Link to="/" class="btn link">לעמוד הבית</Link>
      </header>
      {notice && (
        <div class="banner warn" role="status">
          {notice} <button class="btn link" onClick={() => setNotice(undefined)}>סגירה</button>
        </div>
      )}
      {editing && <p class="hint">זהו משחק שפורסם. לחיצה על "שמור שינויים" תעדכן את אותו קישור תלמידים.</p>}

      <section class="card">
        <label class="field">
          <span>איך קוראים למשחק?</span>
          <input value={game.title} maxLength={LIMITS.title} onInput={(e) => change((g) => ({ ...g, title: (e.target as HTMLInputElement).value }))} />
        </label>
      </section>

      <section class="card">
        <h2>איזה סוג מסלול?</h2>
        <div class="stack">
          {(Object.keys(ROUTE_LABELS) as RouteType[]).map((rt) => (
            <label key={rt} class={`choice${game.routeType === rt ? ' on' : ''}`}>
              <input type="radio" name="route" checked={game.routeType === rt} onChange={() => change((g) => ({ ...g, routeType: rt }))} />
              <span>
                <strong>{ROUTE_LABELS[rt].title}</strong>
                <small>{ROUTE_LABELS[rt].hint}</small>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section class="card">
        <h2>מה התלמיד יראה בהתחלה?</h2>
        <p class="hint">כתבו את סיפור המסגרת, המשימה, והוראות ההתחלה וההגשה.</p>
        <textarea rows={5} value={game.intro.text} maxLength={LIMITS.text} onInput={(e) => change((g) => ({ ...g, intro: { ...g.intro, text: (e.target as HTMLTextAreaElement).value } }))} />
        <ImagePicker
          imageId={game.intro.imageId}
          onPick={(f) => pickImage(f, (id) => change((g) => ({ ...g, intro: { ...g.intro, imageId: id } })), game.intro.imageId)}
          onRemove={() => change((g) => ({ ...g, intro: { ...g.intro, imageId: undefined } }))}
        />
        <label class="field">
          <span>קישור חיצוני (לא חובה, למשל YouTube או מסמך)</span>
          <input type="url" dir="ltr" placeholder="https://" value={game.intro.link ?? ''} onInput={(e) => change((g) => ({ ...g, intro: { ...g.intro, link: (e.target as HTMLInputElement).value } }))} />
        </label>
      </section>

      <section>
        <h2>התחנות ({game.stations.length})</h2>
        <div class="stack">
          {game.stations.map((s, i) => (
            <StationCard
              key={s.id}
              station={s}
              index={i}
              total={game.stations.length}
              open={openId === s.id}
              onToggle={() => setOpenId(openId === s.id ? undefined : s.id)}
              onChange={(fn) => setStation(s.id, fn)}
              onMove={(d) => move(i, d)}
              onRemove={() => removeStation(s.id)}
              onPickImage={(f) => pickImage(f, (id) => setStation(s.id, (x) => ({ ...x, imageId: id })), s.imageId)}
            />
          ))}
        </div>
        <button class="btn primary big" onClick={addStation}>
          + הוסף תחנה
        </button>
      </section>

      {errors.length > 0 && (
        <div class="banner err" role="alert">
          <strong>צריך לתקן לפני שממשיכים:</strong>
          <ul>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <section class="card actions">
        <button class="btn secondary" onClick={onPreview}>
          👁 תצוגה מקדימה
        </button>
        <button class="btn primary" disabled={!!busy} onClick={onPublish}>
          {busy ?? (editing ? 'שמור שינויים' : 'פרסם משחק')}
        </button>
        <button class="btn secondary" onClick={onSaveFile}>
          💾 שמור משחק לשימוש חוזר
        </button>
        <button class="btn secondary" onClick={() => importRef.current?.click()}>
          📂 פתח משחק ששמרתי
        </button>
        <input ref={importRef} type="file" accept=".zip,application/zip" hidden onChange={(e) => (onImport(e.currentTarget.files?.[0]), (e.currentTarget.value = ''))} />
        {editing && (
          <button class="btn danger" onClick={() => setConfirmDelete(true)}>
            מחיקת המשחק מהאתר
          </button>
        )}
      </section>
      <p class="hint">הטיוטה נשמרת אוטומטית במחשב הזה.</p>

      {confirmDelete && (
        <Modal>
          <h2>למחוק את המשחק מהאתר?</h2>
          <p>קישור התלמידים יפסיק לעבוד למי שיפתח אותו מעכשיו, והתמונות יימחקו מהשרת. עותקים שכבר נפתחו אצל תלמידים נשארים אצלם.</p>
          <div class="row">
            <button class="btn secondary" onClick={() => setConfirmDelete(false)}>חזרה</button>
            <button class="btn danger" onClick={onDelete}>כן, למחוק</button>
          </div>
        </Modal>
      )}
      {conflict && (
        <Modal>
          <h2>המשחק עודכן ממקום אחר</h2>
          <p>נשמרה גרסה חדשה יותר בלשונית או במכשיר אחר. כדי לא לדרוס אותה, טענו אותה מחדש. השינויים שעשיתם כאן יאבדו — מומלץ קודם לשמור אותם דרך "שמור משחק לשימוש חוזר".</p>
          <div class="row">
            <button class="btn secondary" onClick={() => setConflict(false)}>סגירה</button>
            <button
              class="btn primary"
              onClick={async () => {
                await discardDraft();
                location.reload();
              }}
            >
              טעינה מחדש
            </button>
          </div>
        </Modal>
      )}
      <Credit />
    </main>
  );
}

/* ---------- רכיבים ---------- */

function ImagePicker({ imageId, onPick, onRemove }: { imageId?: string; onPick: (f: File | undefined) => void; onRemove: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div class="field">
      <span>תמונה (לא חובה)</span>
      {imageId && <BlobImg blobKey={draftImageKey(imageId)} getBlob={draftGetBlob} class="pic small" />}
      <div class="row">
        <button type="button" class="btn secondary" onClick={() => ref.current?.click()}>
          {imageId ? 'החלפת תמונה' : 'הוספת תמונה'}
        </button>
        {imageId && (
          <button type="button" class="btn danger" onClick={onRemove}>
            הסרה
          </button>
        )}
      </div>
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => (onPick(e.currentTarget.files?.[0]), (e.currentTarget.value = ''))} />
    </div>
  );
}

interface CardProps {
  station: Station;
  index: number;
  total: number;
  open: boolean;
  onToggle: () => void;
  onChange: (fn: (s: Station) => Station) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
  onPickImage: (f: File | undefined) => void;
}

function StationCard({ station: s, index, total, open, onToggle, onChange, onMove, onRemove, onPickImage }: CardProps) {
  const set = (patch: Partial<Station>) => onChange((x) => ({ ...x, ...patch }));
  const setCode = (patch: Partial<NonNullable<Station['code']>>) => onChange((x) => ({ ...x, code: x.code ? { ...x.code, ...patch } : x.code }));
  return (
    <div class={`card station${open ? ' open' : ''}`}>
      <div class="station-head">
        <button class="station-title" onClick={onToggle} aria-expanded={open}>
          <span class="num">{index + 1}</span>
          <span>{s.name.trim() || 'תחנה חדשה'}</span>
          <span aria-hidden="true">{open ? '▲' : '▼'}</span>
        </button>
        <div class="row small-row">
          <button class="btn icon" aria-label="הזזה למעלה" disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
          <button class="btn icon" aria-label="הזזה למטה" disabled={index === total - 1} onClick={() => onMove(1)}>↓</button>
          <button class="btn icon danger" aria-label="מחיקת תחנה" onClick={onRemove}>🗑</button>
        </div>
      </div>
      {open && (
        <div class="station-body">
          <label class="field">
            <span>שם התחנה (התלמידים רואים אותו — אפשר שם ניטרלי כמו "תחנה 3")</span>
            <input value={s.name} maxLength={LIMITS.stationName} onInput={(e) => set({ name: (e.target as HTMLInputElement).value })} />
          </label>
          <label class="field">
            <span>תוכן והוראות לתלמיד</span>
            <textarea rows={5} value={s.content} maxLength={LIMITS.text} onInput={(e) => set({ content: (e.target as HTMLTextAreaElement).value })} />
          </label>
          <ImagePicker imageId={s.imageId} onPick={onPickImage} onRemove={() => set({ imageId: undefined })} />
          <label class="field">
            <span>קישור חיצוני (לא חובה)</span>
            <input type="url" dir="ltr" placeholder="https://" value={s.link ?? ''} onInput={(e) => set({ link: (e.target as HTMLInputElement).value })} />
          </label>

          <fieldset class="field">
            <legend>
              מה התלמיד צריך להגיש?
              <Info>התוצר נשמר בטלפון של התלמיד ויופיע בדוח שלו. המערכת לא בודקת אותו, ואין ציונים.</Info>
            </legend>
            <label class="check">
              <input
                type="checkbox"
                checked={!s.submit.text && !s.submit.photo && !s.submit.audio}
                onChange={() => set({ submit: { text: false, photo: false, audio: false } })}
              />
              לא נדרש תוצר
            </label>
            {(
              [
                ['text', 'תשובה כתובה'],
                ['photo', 'צילום/תמונה'],
                ['audio', 'הקלטת קול'],
              ] as const
            ).map(([k, label]) => (
              <label class="check" key={k}>
                <input type="checkbox" checked={s.submit[k]} onChange={(e) => {
                    const checked = (e.target as HTMLInputElement).checked;
                    onChange((x) => ({ ...x, submit: { ...x.submit, [k]: checked } }));
                  }}
                />
                {label}
              </label>
            ))}
          </fieldset>

          <fieldset class="field">
            <legend>
              קוד מעבר (לא חובה)
              <Info>משמש כחידה קצרה. עדיף תשובה קצרה וחד-משמעית. זה אלמנט משחקי ולא אבטחה. במסלול קווי הוא נדרש כדי לפתוח את התחנה הבאה.</Info>
            </legend>
            <label class="check">
              <input
                type="checkbox"
                checked={!!s.code}
                onChange={(e) => set({ code: (e.target as HTMLInputElement).checked ? { prompt: '', answers: [''], reveal: '' } : undefined })}
              />
              יש קוד מעבר בתחנה
            </label>
            {s.code && (
              <div class="stack">
                <label class="field">
                  <span>שאלה או הנחיה (לא חובה)</span>
                  <textarea rows={2} value={s.code.prompt} onInput={(e) => setCode({ prompt: (e.target as HTMLTextAreaElement).value })} />
                </label>
                <label class="field">
                  <span>תשובות מתקבלות — כל תשובה בשורה נפרדת (למשל "5" ו"חמש")</span>
                  <textarea rows={3} value={s.code.answers.join('\n')} onInput={(e) => setCode({ answers: (e.target as HTMLTextAreaElement).value.split('\n') })} />
                  <small class="hint">לא משנה אותיות גדולות/קטנות באנגלית, ניקוד, או רווחים מיותרים. אין התאמה לפי משמעות.</small>
                </label>
                <label class="field">
                  <span>טקסט או רמז שיוצג אחרי תשובה נכונה (לא חובה)</span>
                  <textarea rows={2} value={s.code.reveal} onInput={(e) => setCode({ reveal: (e.target as HTMLTextAreaElement).value })} />
                </label>
              </div>
            )}
          </fieldset>
        </div>
      )}
    </div>
  );
}
