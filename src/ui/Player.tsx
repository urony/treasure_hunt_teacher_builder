import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { fetchGame, fetchImage } from '../lib/api';
import { describeStorageError, requestPersistence } from '../lib/idb';
import { uid, safeFileName } from '../lib/ids';
import { toWav } from '../lib/audio';
import { compressImage } from '../lib/image';
import { buildReport, reportFiles, ReportFile } from '../lib/report';
import { canShareFiles, downloadFiles, looksLikeInAppBrowser, shareFiles } from '../lib/share';
import { OUTCOME_TEXT, stationOutcome } from '../lib/status';
import {
  BlobRec,
  clearGameData,
  idbPlayStore,
  loadSavedGame,
  mimeToExt,
  PlayStore,
  Progress,
  saveSavedGame,
  studentBlobKey,
  teacherImageKey,
} from '../lib/storage';
import { isCorrectAnswer } from '../shared/normalize';
import { collectImageIds } from '../shared/validate';
import { Game, LIMITS, Station } from '../shared/types';
import { BlobImg, Credit, ExternalLink, Modal, navigate, TripDecor } from './common';

/* ========================================================================
 * מסלול /g/:id — טעינה, המשך מהמקום שעצרתי, או התחלה חדשה
 * ====================================================================== */

type Stage =
  | { kind: 'loading' }
  | { kind: 'error'; msg: string }
  | { kind: 'choice'; progress: Progress; game: Game; version: number }
  | { kind: 'name'; title: string; game: Game; version: number }
  | { kind: 'starting' }
  | { kind: 'play'; progress: Progress; game: Game };

export function PlayRoute({ gameId }: { gameId: string }) {
  const store = useMemo(() => idbPlayStore(gameId), [gameId]);
  const [stage, setStage] = useState<Stage>({ kind: 'loading' });
  const [name, setName] = useState('');
  const [confirmRestart, setConfirmRestart] = useState(false);

  async function init() {
    setStage({ kind: 'loading' });
    try {
      const [progress, saved] = await Promise.all([store.loadProgress(), loadSavedGame(gameId)]);
      if (progress && saved) {
        setStage({ kind: 'choice', progress, game: saved.game, version: saved.version });
        return;
      }
    } catch {
      /* אחסון לא זמין — ממשיכים כמשחק חדש; השמירה תכשל בצורה מוסברת */
    }
    await loadFresh();
  }

  async function loadFresh() {
    setStage({ kind: 'loading' });
    try {
      const pub = await fetchGame(gameId);
      setStage({ kind: 'name', title: pub.game.title, game: pub.game, version: pub.version });
    } catch (e) {
      setStage({ kind: 'error', msg: (e as Error).message });
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void init(), [gameId]);

  async function start(game: Game, version: number) {
    setStage({ kind: 'starting' });
    try {
      await clearGameData(gameId);
      // מורידים את תמונות המורה למכשיר לפני שמתחילים, כדי שהמשחק יעבוד גם עם קליטה חלשה
      for (const imageId of collectImageIds(game)) {
        const { blob, mime } = await fetchImage(gameId, imageId);
        await store.putBlob(teacherImageKey(gameId, imageId), { blob, mime, ext: mimeToExt(mime) });
      }
      await saveSavedGame(gameId, { game, version });
      const progress: Progress = {
        gameId,
        gameVersion: version,
        studentName: name.trim(),
        startedAt: Date.now(),
        phase: 'intro',
        maxIndex: 0,
        visited: [],
        solved: [],
        subs: {},
      };
      await store.saveProgress(progress);
      void requestPersistence();
      setStage({ kind: 'play', progress, game });
    } catch (e) {
      const msg = (e as Error).name?.includes('Quota') || (e as Error).name === 'QuotaExceededError' ? describeStorageError(e) : (e as Error).message;
      setStage({ kind: 'error', msg });
    }
  }

  if (stage.kind === 'loading' || stage.kind === 'starting') {
    return (
      <main class="page center">
        <p class="spinner-text">{stage.kind === 'starting' ? 'מכינים את המשחק בטלפון…' : 'טוענים…'}</p>
      </main>
    );
  }
  if (stage.kind === 'error') {
    return (
      <main class="page center">
        <h1>אופס</h1>
        <p class="banner err">{stage.msg}</p>
        <button class="btn primary big" onClick={() => void init()}>
          נסו שוב
        </button>
      </main>
    );
  }
  if (stage.kind === 'choice') {
    const { progress, game } = stage;
    return (
      <main class="page">
        <h1>{game.title}</h1>
        <InAppTip />
        <div class="card">
          <p>
            נמצאה התקדמות במכשיר הזה של: <strong>{progress.studentName}</strong>
          </p>
          <button class="btn primary big" onClick={() => setStage({ kind: 'play', progress, game })}>
            להמשיך מהמקום שבו הפסקתי
          </button>
          <button class="btn secondary big" onClick={() => setConfirmRestart(true)}>
            להתחיל מחדש
          </button>
          <p class="hint">אם זה לא השם שלכם — המכשיר משותף. התחלה מחדש תמחק את ההתקדמות של {progress.studentName} מהמכשיר.</p>
        </div>
        {confirmRestart && (
          <Modal>
            <h2>להתחיל מחדש?</h2>
            <p>
              כל התשובות, התמונות וההקלטות של <strong>{progress.studentName}</strong> יימחקו מהמכשיר. אם עוד לא שמרתם דוח — הם יאבדו.
            </p>
            <div class="row">
              <button class="btn secondary" onClick={() => setConfirmRestart(false)}>
                חזרה
              </button>
              <button
                class="btn danger"
                onClick={async () => {
                  setConfirmRestart(false);
                  await clearGameData(gameId);
                  await loadFresh();
                }}
              >
                כן, למחוק ולהתחיל מחדש
              </button>
            </div>
          </Modal>
        )}
        <Credit />
      </main>
    );
  }
  if (stage.kind === 'name') {
    const ok = name.trim().length > 0;
    return (
      <main class="page">
        <div class="hero" aria-hidden="true">🧭</div>
        <h1 class="center-text">{stage.title}</h1>
        <InAppTip />
        <form
          class="card"
          onSubmit={(e) => {
            e.preventDefault();
            if (ok) void start(stage.game, stage.version);
          }}
        >
          <label class="field">
            <span>שם התלמיד או הקבוצה</span>
            <input value={name} maxLength={60} autoComplete="off" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          </label>
          <button class="btn primary big" type="submit" disabled={!ok}>
            המשך
          </button>
          <p class="hint">השם מופיע רק בדוח שתפיקו. כל מה שתכתבו, תצלמו ותקליטו נשמר בטלפון שלכם בלבד.</p>
        </form>
        <Credit />
      </main>
    );
  }
  return <PlayGame game={stage.game} initial={stage.progress} store={store} imageKey={(id) => teacherImageKey(gameId, id)} onClear={() => navigate('/')} />;
}

function InAppTip() {
  const [show, setShow] = useState(looksLikeInAppBrowser());
  if (!show) return null;
  return (
    <div class="banner warn">
      <p>
        <strong>טיפ:</strong> אם צילום, הקלטה או הורדה אינם עובדים, פתחו את הקישור ב-Chrome או ב-Safari. בוואטסאפ: לחצו על שלוש הנקודות או על סמל המצפן, ובחרו "פתח בדפדפן".
      </p>
      <button class="btn link" onClick={() => setShow(false)}>
        הבנתי
      </button>
    </div>
  );
}

/* ========================================================================
 * הנגן עצמו (משמש גם לתצוגה מקדימה, עם store בזיכרון)
 * ====================================================================== */

export interface PlayGameProps {
  game: Game;
  initial: Progress;
  store: PlayStore;
  imageKey: (imageId: string) => string;
  preview?: boolean;
  onClear?: () => void;
}

export function PlayGame({ game, initial, store, imageKey, preview, onClear }: PlayGameProps) {
  const [p, setP] = useState(initial);
  const pRef = useRef(initial);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const [saveError, setSaveError] = useState<string>();
  const [confirmFinish, setConfirmFinish] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const N = game.stations.length;

  const update = (fn: (p: Progress) => Progress) => {
    const next = fn(pRef.current);
    pRef.current = next;
    setP(next);
    chain.current = chain.current
      .then(() => store.saveProgress(next))
      .then(
        () => setSaveError(undefined),
        (e) => setSaveError(describeStorageError(e)),
      );
  };

  const idxOf = (id?: string) => game.stations.findIndex((s) => s.id === id);
  const current = game.stations[idxOf(p.currentStationId)] as Station | undefined;

  // תחנה שנפתחה מסומנת כ"ביקרתי"
  useEffect(() => {
    if (p.phase === 'play' && p.currentStationId && !p.visited.includes(p.currentStationId)) {
      update((q) => ({ ...q, visited: [...q.visited, q.currentStationId!] }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.phase, p.currentStationId]);

  useEffect(() => {
    mainRef.current?.scrollIntoView({ block: 'start' });
    window.scrollTo(0, 0);
  }, [p.currentStationId, p.phase]);

  const accessible = (i: number) => game.routeType !== 'linear' || i <= p.maxIndex;

  const open = (id: string) => {
    const i = idxOf(id);
    if (i < 0 || !accessible(i)) return;
    update((q) => ({ ...q, currentStationId: id, maxIndex: Math.max(q.maxIndex, i) }));
  };

  const begin = () => {
    update((q) => ({
      ...q,
      phase: 'play',
      currentStationId: game.routeType === 'linear' ? game.stations[0].id : q.currentStationId,
    }));
  };

  if (p.phase === 'finish') {
    return (
      <FinishView
        game={game}
        progress={p}
        store={store}
        preview={preview}
        onBack={() => update((q) => ({ ...q, phase: 'play' }))}
        onClear={onClear}
      />
    );
  }

  const header = (
    <header class="topbar">
      <span class="compass" aria-hidden="true">
        🧭
      </span>
      <div class="tb-text">
        <strong>{game.title}</strong>
        <span class="who">{p.studentName}</span>
      </div>
      <TripDecor />
    </header>
  );

  if (p.phase === 'intro') {
    return (
      <div class="shell">
        {header}
        {saveError && <div class="banner err">{saveError}</div>}
        <main class="page" ref={mainRef}>
          <div class="card prose">
            {game.intro.imageId && <BlobImg blobKey={imageKey(game.intro.imageId)} getBlob={store.getBlob} />}
            <p class="pre">{game.intro.text}</p>
            {game.intro.link && <ExternalLink href={game.intro.link}>פתיחת הקישור</ExternalLink>}
          </div>
          <button class="btn primary big" onClick={begin}>
            התחל את ההרפתקה 🚀
          </button>
        </main>
      </div>
    );
  }

  const needsStart = game.routeType === 'circular' && !p.startingStationId;

  return (
    <div class="shell">
      {header}
      {saveError && <div class="banner err">{saveError}</div>}
      {!needsStart && (
        <nav class="strip" aria-label="תחנות">
          {game.stations.map((s, i) => {
            const visited = p.visited.includes(s.id);
            const locked = !accessible(i);
            const out = stationOutcome(s, p.subs[s.id], visited);
            return (
              <button
                key={s.id}
                class={`chip${s.id === p.currentStationId ? ' current' : ''}${visited ? ' visited' : ''}`}
                disabled={locked}
                aria-label={`${s.name}${visited ? ', ביקרתי' : ''}${locked ? ', נעולה' : ''}`}
                onClick={() => open(s.id)}
              >
                <span class="chip-num">{locked ? '🔒' : visited && s.id !== p.currentStationId ? '✓' : i + 1}</span>
                <span class={`chip-state ${out}`}>{out === 'full' ? 'הוגש' : out === 'missing' ? 'חסר תוצר' : out === 'partial' ? 'חלקי' : ''}</span>
              </button>
            );
          })}
        </nav>
      )}
      {!needsStart && (
        <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={N} aria-valuenow={p.visited.length} aria-label="התקדמות">
          <div class="progress-fill" style={{ width: `${Math.round((p.visited.length / N) * 100)}%` }} />
          <span>ביקרתם ב-{p.visited.length} מתוך {N}</span>
        </div>
      )}
      <main class="page" ref={mainRef}>
        {needsStart ? (
          <div class="card">
            <h2>📍 מאיזו תחנה מתחילים?</h2>
            <p class="hint">בחרו את תחנת ההתחלה לפי הנחיית המורה.</p>
            <div class="stack">
              {game.stations.map((s, i) => (
                <button
                  key={s.id}
                  class="btn secondary big"
                  onClick={() => update((q) => ({ ...q, startingStationId: s.id, currentStationId: s.id, maxIndex: i }))}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        ) : !current ? (
          <div class="card">
            <h2>בחרו תחנה</h2>
            <div class="stack">
              {game.stations.map((s) => (
                <button key={s.id} class="btn secondary big" onClick={() => open(s.id)}>
                  {p.visited.includes(s.id) ? '✓ ' : ''}
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <StationView
            key={current.id}
            game={game}
            station={current}
            index={idxOf(current.id)}
            progress={p}
            store={store}
            imageKey={imageKey}
            update={update}
            setSaveError={setSaveError}
            open={open}
            advance={(id) => update((q) => ({ ...q, currentStationId: id, maxIndex: Math.max(q.maxIndex, idxOf(id)) }))}
            clearCurrent={() => update((q) => ({ ...q, currentStationId: undefined }))}
          />
        )}
      </main>
      <footer class="footer-bar">
        <button class="btn finish" onClick={() => setConfirmFinish(true)}>
          🏁 סיימתי את המשחק
        </button>
      </footer>
      {confirmFinish && (
        <Modal>
          <h2>לסיים את המשחק ולעבור להפקת דוח?</h2>
          <p class="hint">אפשר לחזור למשחק גם אחרי זה.</p>
          <div class="row">
            <button class="btn secondary" onClick={() => setConfirmFinish(false)}>
              חזרה למשחק
            </button>
            <button
              class="btn primary"
              onClick={() => {
                setConfirmFinish(false);
                update((q) => ({ ...q, phase: 'finish' }));
              }}
            >
              כן, סיימתי
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ========================================================================
 * תחנה
 * ====================================================================== */

interface StationViewProps {
  game: Game;
  station: Station;
  index: number;
  progress: Progress;
  store: PlayStore;
  imageKey: (id: string) => string;
  update: (fn: (p: Progress) => Progress) => void;
  setSaveError: (s: string | undefined) => void;
  open: (id: string) => void;
  /** מעבר מודרך קדימה (במסלול קווי פותח את התחנה הבאה) */
  advance: (id: string) => void;
  clearCurrent: () => void;
}

function StationView(props: StationViewProps) {
  const { game, station: st, index, progress: p, store, imageKey, update, open } = props;
  const N = game.stations.length;
  const solved = p.solved.includes(st.id);
  const codeBlocks = !!st.code && !solved && game.routeType === 'linear';
  const out = stationOutcome(st, p.subs[st.id], true);
  const allVisited = game.stations.every((s) => p.visited.includes(s.id));

  const nextId = game.stations[(index + 1) % N]?.id;
  const prevId = game.stations[index - 1]?.id;

  return (
    <div class="stack">
      <div class="card prose">
        <h2>
          <span class="station-ico" aria-hidden="true">
            📍
          </span>
          {st.name}
        </h2>
        {st.imageId && <BlobImg blobKey={imageKey(st.imageId)} getBlob={store.getBlob} />}
        <p class="pre">{st.content}</p>
        {st.link && <ExternalLink href={st.link}>פתיחת הקישור</ExternalLink>}
      </div>

      <SubmitArea {...props} />

      {st.code && <CodeBox station={st} solved={solved} onSolved={() => update((q) => ({ ...q, solved: [...new Set([...q.solved, st.id])] }))} />}

      {out !== 'notRequired' && (
        <p class={`status ${out}`}>{out === 'full' ? 'הוגש ✓' : out === 'partial' ? 'הוגש חלקית — אפשר להשלים' : 'עדיין לא הוגש תוצר (אפשר להמשיך גם כך)'}</p>
      )}

      {game.routeType === 'linear' && index === N - 1 && (
        <div class="banner ok">הגעתם לתחנה האחרונה. לחצו סיימתי כדי להפיק דוח.</div>
      )}
      {game.routeType === 'circular' && allVisited && <div class="banner ok">ביקרתם בכל התחנות. אפשר ללחוץ סיימתי כדי להפיק דוח.</div>}

      <div class="row nav">
        {game.routeType === 'linear' && (
          <>
            {prevId && (
              <button class="btn secondary" onClick={() => open(prevId)}>
                ← התחנה הקודמת
              </button>
            )}
            {index < N - 1 && (
              <button class="btn primary" disabled={codeBlocks} onClick={() => props.advance(game.stations[index + 1].id)}>
                התחנה הבאה →
              </button>
            )}
          </>
        )}
        {game.routeType === 'circular' && (
          <button class={`btn ${solved || !st.code ? 'primary' : 'secondary'}`} onClick={() => open(nextId)}>
            התחנה הבאה →
          </button>
        )}
        {game.routeType === 'free' && (
          <button class="btn secondary" onClick={props.clearCurrent}>
            לרשימת התחנות
          </button>
        )}
      </div>
      {codeBlocks && <p class="hint">כדי לעבור לתחנה הבאה צריך לפתור את הקוד.</p>}
    </div>
  );
}

function CodeBox({ station, solved, onSolved }: { station: Station; solved: boolean; onSolved: () => void }) {
  const code = station.code!;
  const [val, setVal] = useState('');
  const [wrong, setWrong] = useState(false);
  return (
    <div class="card">
      <h3>🔑 קוד מעבר</h3>
      {code.prompt && <p class="pre">{code.prompt}</p>}
      {solved ? (
        <>
          <p class="banner ok">הקוד נכון ✓</p>
          {code.reveal && <p class="pre reveal">{code.reveal}</p>}
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isCorrectAnswer(val, code.answers)) {
              setWrong(false);
              onSolved();
            } else setWrong(true);
          }}
        >
          <label class="field">
            <span>התשובה שלכם</span>
            <input value={val} autoComplete="off" onInput={(e) => (setVal((e.target as HTMLInputElement).value), setWrong(false))} />
          </label>
          <button class="btn primary" type="submit">
            בדיקה
          </button>
          {wrong && (
            <div class="banner warn">
              <p>עדיין לא, נסו שוב.</p>
              {code.hint && <p class="pre"><strong>רמז:</strong> {code.hint}</p>}
            </div>
          )}
        </form>
      )}
    </div>
  );
}

/* ---------- תוצרי תלמיד ---------- */

function SubmitArea({ game, station: st, progress: p, store, update, setSaveError }: StationViewProps) {
  const sub = p.subs[st.id] ?? { text: '', photos: [], audio: undefined };
  const gameId = p.gameId;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  if (!st.submit.text && !st.submit.photo && !st.submit.audio) return null;

  const setSub = (fn: (s: typeof sub) => typeof sub) =>
    update((q) => ({ ...q, subs: { ...q.subs, [st.id]: fn(q.subs[st.id] ?? { text: '', photos: [] }) } }));

  async function saveBlob(rec: BlobRec): Promise<string | null> {
    const key = studentBlobKey(gameId, uid());
    try {
      await store.putBlob(key, rec);
      setSaveError(undefined);
      return key;
    } catch (e) {
      setSaveError(describeStorageError(e));
      return null;
    }
  }

  async function addPhotos(files: FileList | null) {
    if (!files || !files.length) return;
    setErr(undefined);
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        const have = (pRefPhotos()).length;
        if (have >= LIMITS.studentPhotosPerStation) {
          setErr(`אפשר עד ${LIMITS.studentPhotosPerStation} תמונות בתחנה.`);
          break;
        }
        const blob = await compressImage(f);
        const key = await saveBlob({ blob, mime: 'image/jpeg', ext: 'jpg' });
        if (key) setSub((s) => ({ ...s, photos: [...s.photos, key] }));
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  // הספירה מתוך ה-state העדכני ביותר (כולל תמונות שנוספו באותה קריאה)
  const photosNow = useRef(sub.photos);
  photosNow.current = sub.photos;
  const pRefPhotos = () => photosNow.current;

  async function removePhoto(key: string) {
    setSub((s) => ({ ...s, photos: s.photos.filter((k) => k !== key) }));
    await store.deleteBlob(key).catch(() => {});
  }

  async function setAudio(rec: BlobRec) {
    const key = await saveBlob(rec);
    if (!key) return;
    const old = sub.audio;
    setSub((s) => ({ ...s, audio: key }));
    if (old) await store.deleteBlob(old).catch(() => {});
  }

  async function removeAudio() {
    const old = sub.audio;
    setSub((s) => ({ ...s, audio: undefined }));
    if (old) await store.deleteBlob(old).catch(() => {});
  }

  return (
    <div class="card">
      <h3>מה מגישים בתחנה</h3>
      {st.submit.text && (
        <label class="field">
          <span>תשובה כתובה</span>
          <textarea rows={4} value={sub.text} maxLength={LIMITS.text} onInput={(e) => setSub((s) => ({ ...s, text: (e.target as HTMLTextAreaElement).value }))} />
        </label>
      )}
      {st.submit.photo && (
        <div class="field">
          <span>
            צילום או תמונה ({sub.photos.length}/{LIMITS.studentPhotosPerStation})
          </span>
          <div class="thumbs">
            {sub.photos.map((k) => (
              <div class="thumb" key={k}>
                <BlobImg blobKey={k} getBlob={store.getBlob} class="thumb-img" />
                <button class="btn danger small" onClick={() => removePhoto(k)}>
                  מחיקה
                </button>
              </div>
            ))}
          </div>
          {sub.photos.length < LIMITS.studentPhotosPerStation && (
            <div class="row">
              <button class="btn secondary" disabled={busy} onClick={() => cameraRef.current?.click()}>
                📷 צילום
              </button>
              <button class="btn secondary" disabled={busy} onClick={() => galleryRef.current?.click()}>
                🖼 בחירה מהגלריה
              </button>
            </div>
          )}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (addPhotos(e.currentTarget.files), (e.currentTarget.value = ''))} />
          <input ref={galleryRef} type="file" accept="image/*" multiple hidden onChange={(e) => (addPhotos(e.currentTarget.files), (e.currentTarget.value = ''))} />
          {busy && <p class="hint">מעבדים את התמונה…</p>}
        </div>
      )}
      {st.submit.audio && (
        <div class="field">
          <span>הקלטת קול (עד {LIMITS.audioMaxSeconds} שניות)</span>
          <AudioInput store={store} audioKey={sub.audio} onSave={setAudio} onRemove={removeAudio} />
        </div>
      )}
      {err && <p class="banner err">{err}</p>}
      <p class="hint">התוצרים נשמרים בטלפון שלכם ויופיעו בדוח. המערכת לא בודקת אותם.</p>
    </div>
  );
}

function pickAudioMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return undefined;
  return ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m));
}

function AudioInput({ store, audioKey, onSave, onRemove }: { store: PlayStore; audioKey?: string; onSave: (r: BlobRec) => void; onRemove: () => void }) {
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState<string>();
  const [url, setUrl] = useState<string>();
  const [playNote, setPlayNote] = useState(false);
  const [converting, setConverting] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const canRecord = !!pickAudioMime() && !!navigator.mediaDevices?.getUserMedia;

  useEffect(() => {
    let u: string | undefined;
    let cancelled = false;
    setUrl(undefined);
    if (audioKey) {
      store.getBlob(audioKey).then((r) => {
        if (r && !cancelled) {
          u = URL.createObjectURL(r.blob);
          setUrl(u);
          setPlayNote(!document.createElement('audio').canPlayType(r.mime.split(';')[0]));
        }
      });
    }
    return () => {
      cancelled = true;
      if (u) URL.revokeObjectURL(u);
    };
  }, [audioKey]);

  useEffect(() => () => recRef.current?.state === 'recording' && recRef.current.stop(), []);

  /** ממיר ל-WAV כדי שהקובץ יתנגן וישותף בכל מכשיר (כולל וואטסאפ). אם ההמרה נכשלת — שומרים את המקור. */
  async function finish(raw: Blob, mime: string) {
    setConverting(true);
    try {
      onSave({ blob: await toWav(raw), mime: 'audio/wav', ext: 'wav' });
    } catch {
      setErr('לא הצלחנו להמיר את ההקלטה לפורמט שמתאים לשיתוף. היא נשמרה כמות שהיא, וייתכן שוואטסאפ לא יצליח לנגן אותה.');
      onSave({ blob: raw, mime, ext: mimeToExt(mime) });
    } finally {
      setConverting(false);
    }
  }

  async function startRec() {
    setErr(undefined);
    const mime = pickAudioMime()!;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setErr('אין הרשאה למיקרופון. אפשר לאשר אותה בהגדרות הדפדפן, או לבחור קובץ קול מהטלפון.');
      return;
    }
    const chunks: BlobPart[] = [];
    const rec = new MediaRecorder(stream, { mimeType: mime });
    recRef.current = rec;
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(timer);
      setRecording(false);
      const base = mime.split(';')[0];
      const blob = new Blob(chunks, { type: base });
      if (blob.size > 0) void finish(blob, base);
      else setErr('ההקלטה יצאה ריקה. נסו שוב.');
    };
    let s = 0;
    setSecs(0);
    const timer = setInterval(() => {
      s++;
      setSecs(s);
      if (s >= LIMITS.audioMaxSeconds && rec.state === 'recording') rec.stop();
    }, 1000);
    rec.start();
    setRecording(true);
  }

  async function pickFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) return setErr('קובץ הקול גדול מדי (עד 15MB).');
    if (!f.type.startsWith('audio/') && !f.type.startsWith('video/')) return setErr('בחרו קובץ קול.');
    setErr(undefined);
    await finish(f, f.type || 'audio/mp4');
  }

  return (
    <div class="stack">
      {url && (
        <>
          <audio controls src={url} class="audio" />
          {playNote && <p class="hint">ייתכן שהקובץ לא יתנגן בטלפון הזה, אבל הוא ישמר וישלח עם הדוח.</p>}
        </>
      )}
      {converting && <p class="hint">מעבדים את ההקלטה…</p>}
      {recording ? (
        <button class="btn danger big" onClick={() => recRef.current?.stop()}>
          ⏹ עצירה ({secs} שנ׳)
        </button>
      ) : (
        <div class="row">
          {canRecord && (
            <button class="btn secondary" onClick={startRec}>
              🎙 {audioKey ? 'הקלטה מחדש' : 'הקלטה'}
            </button>
          )}
          <button class="btn secondary" onClick={() => fileRef.current?.click()}>
            📁 בחירת קובץ קול
          </button>
          {audioKey && (
            <button class="btn danger" onClick={onRemove}>
              מחיקה
            </button>
          )}
        </div>
      )}
      {!canRecord && <p class="hint">הקלטה ישירה לא זמינה בדפדפן הזה. אפשר לבחור קובץ קול מהטלפון.</p>}
      <input ref={fileRef} type="file" accept="audio/*" hidden onChange={(e) => (pickFile(e.currentTarget.files?.[0]), (e.currentTarget.value = ''))} />
      {err && <p class="banner err">{err}</p>}
    </div>
  );
}

/* ========================================================================
 * סיום והפקת דוח
 * ====================================================================== */

/** כפתור שיתוף לקבוצת קבצים. כל לחיצה היא שיתוף נפרד (נדרש מגע חדש לכל חלון שיתוף). */
function ShareButton({ label, files, title, done, onDone, onError }: { label: string; files: ReportFile[]; title: string; done: boolean; onDone: () => void; onError: (m: string) => void }) {
  if (!canShareFiles(files)) return null;
  return (
    <button
      class={`btn big ${done ? 'secondary' : 'primary'}`}
      onClick={async () => {
        try {
          if (await shareFiles(files, title)) onDone();
        } catch (e) {
          onError(`השיתוף של ${label} לא הצליח (${(e as Error).name}). אפשר לשמור את הקבצים במכשיר ולשלוח אותם ידנית.`);
        }
      }}
    >
      {done ? '✓ ' : '↗ '}שיתוף {label}
    </button>
  );
}

function FinishView({ game, progress, store, preview, onBack, onClear }: { game: Game; progress: Progress; store: PlayStore; preview?: boolean; onBack: () => void; onClear?: () => void }) {
  const [msg, setMsg] = useState<string>();
  const [result, setResult] = useState<ReportFile[]>();
  const [err, setErr] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [shared, setShared] = useState<string[]>([]);
  const [audioEach, setAudioEach] = useState(false);
  const markShared = (k: string) => {
    setShared((x) => [...new Set([...x, k])]);
    setSaved(true);
    setErr(undefined);
  };

  async function generate() {
    setErr(undefined);
    setResult(undefined);
    setSaved(false);
    setShared([]);
    setAudioEach(false);
    try {
      setMsg('מכינים את הדוח…');
      const r = await buildReport({ game, progress, getBlob: store.getBlob, onProgress: setMsg });
      const base = `דוח ${safeFileName(game.title, 'משחק')} - ${safeFileName(progress.studentName, 'תלמיד')}`;
      const files = reportFiles(r, base);
      setResult(files);
    } catch (e) {
      console.error(e);
      setErr('לא הצלחנו להפיק את הדוח (ייתכן שאין מספיק זיכרון בטלפון). נסו לסגור לשוניות אחרות ולהפיק שוב.');
    } finally {
      setMsg(undefined);
    }
  }

  const visitedCount = progress.visited.length;

  return (
    <main class="page">
      <div class="hero trophy" aria-hidden="true">🏆</div>
      <h1 class="center-text">סיימתם!</h1>
      <p>
        {progress.studentName} · ביקרתם ב-{visitedCount} מתוך {game.stations.length} תחנות
      </p>
      {preview && <p class="banner warn">זו תצוגה מקדימה — הדוח נוצר כמו אצל תלמיד, אבל שום דבר לא נשמר.</p>}
      <InAppTip />
      <div class="card finish-card">
        {!result && (
          <button class="btn primary big" disabled={!!msg} onClick={generate}>
            הפקת דוח
          </button>
        )}
        {msg && <p class="spinner-text">{msg}</p>}
        {err && <p class="banner err">{err}</p>}
        {result && (
          <div class="stack">
            <p class="banner ok">
              הדוח מוכן: קובץ PDF{result.length > 1 ? ` ו-${result.length - 1} הקלטות` : ''} ({(result.reduce((n, f) => n + f.blob.size, 0) / 1024 / 1024).toFixed(1)}MB)
            </p>
            {canShareFiles([result[0]]) && <h3>שיתוף — כל חלק בנפרד</h3>}
            <ShareButton
              label="הדוח (PDF)"
              files={[result[0]]}
              title={game.title}
              done={shared.includes('pdf')}
              onDone={() => markShared('pdf')}
              onError={setErr}
            />
            {result.length > 1 && !audioEach && (
              <ShareButton
                label={`ההקלטות (${result.length - 1})`}
                files={result.slice(1)}
                title={game.title}
                done={shared.includes('audio')}
                onDone={() => markShared('audio')}
                onError={(m) => {
                  setErr(m);
                  setAudioEach(true);
                }}
              />
            )}
            {result.length > 1 &&
              audioEach &&
              result.slice(1).map((f) => (
                <ShareButton
                  key={f.name}
                  label={f.name.replace(/.[a-z0-9]+$/i, '')}
                  files={[f]}
                  title={game.title}
                  done={shared.includes(f.name)}
                  onDone={() => markShared(f.name)}
                  onError={setErr}
                />
              ))}
            <h3>{canShareFiles([result[0]]) ? 'או שמירה במכשיר' : 'שמירה במכשיר'}</h3>
            <button
              class={`btn big ${canShareFiles([result[0]]) ? 'secondary' : ''}`}
              onClick={async () => {
                await downloadFiles(result);
                markShared('saved');
              }}
            >
              ⬇ שמירת כל הקבצים
            </button>
            <p class="hint">
              {canShareFiles([result[0]])
                ? 'שלחו את הדוח ואת ההקלטות בנפרד, למשל לוואטסאפ של המורה. אם משהו לא נשלח, שמרו את הקבצים ושלחו אותם ידנית מהמכשיר (סמל המהדק ← מסמך).'
                : 'הדפדפן הזה לא תומך בשיתוף קבצים. שמרו את הקבצים, ואז שלחו אותם למורה בוואטסאפ כמסמך (סמל המהדק ← מסמך) או במייל.'}{' '}
              {result.length > 1 && 'בשמירה ייתכן שהדפדפן ישאל אם לאפשר הורדת כמה קבצים — אשרו. '}
              אם ההורדה לא מתחילה, פתחו את הקישור ב-Chrome או ב-Safari.
            </p>
          </div>
        )}
      </div>
      <button class="btn secondary" onClick={onBack}>
        חזרה למשחק
      </button>
      {saved && !preview && (
        <div class="card">
          <p class="hint">אחרי ששלחתם את הדוח למורה, אפשר לפנות מקום ולנקות את נתוני המשחק מהמכשיר.</p>
          <button class="btn danger" onClick={() => setConfirmClear(true)}>
            ניקוי נתוני המשחק מהמכשיר
          </button>
        </div>
      )}
      {confirmClear && (
        <Modal>
          <h2>לנקות את נתוני המשחק?</h2>
          <p>התשובות, התמונות וההקלטות יימחקו מהטלפון. ודאו שקובץ הדוח נשמר ונשלח.</p>
          <div class="row">
            <button class="btn secondary" onClick={() => setConfirmClear(false)}>
              חזרה
            </button>
            <button
              class="btn danger"
              onClick={async () => {
                await clearGameData(progress.gameId);
                onClear?.();
              }}
            >
              כן, לנקות
            </button>
          </div>
        </Modal>
      )}
      <p class="hint privacy">הצילומים וההקלטות נשמרו רק בטלפון שלכם. שתפו אותם רק לפי הנחיות המורה.</p>
      <Credit />
    </main>
  );
}

export { OUTCOME_TEXT };
