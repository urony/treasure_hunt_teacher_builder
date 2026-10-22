import { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { safeHttpsUrl } from '../shared/validate';
import type { BlobRec } from '../lib/storage';

export function navigate(path: string, replace = false) {
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function Link({ to, children, class: cls }: { to: string; children: ComponentChildren; class?: string }) {
  return (
    <a
      href={to}
      class={cls}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

/** מציג תמונה מתוך blob (נטען אסינכרונית, משחרר URL בסיום) */
export function BlobImg({
  blobKey,
  getBlob,
  alt = '',
  class: cls,
}: {
  blobKey: string;
  getBlob: (key: string) => Promise<BlobRec | undefined>;
  alt?: string;
  class?: string;
}) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    let u: string | undefined;
    setUrl(undefined);
    getBlob(blobKey).then((rec) => {
      if (rec && !cancelled) {
        u = URL.createObjectURL(rec.blob);
        setUrl(u);
      }
    });
    return () => {
      cancelled = true;
      if (u) URL.revokeObjectURL(u);
    };
    // getBlob יציב לאורך חיי הרכיב
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blobKey]);
  return url ? <img src={url} alt={alt} class={cls ?? 'pic'} /> : <div class="pic pic-loading" aria-hidden="true" />;
}

/** קישור חיצוני בטוח: רק https, נפתח בלשונית חדשה בלי הפניה */
export function ExternalLink({ href, children }: { href: string; children: ComponentChildren }) {
  const safe = safeHttpsUrl(href);
  if (!safe) return null;
  return (
    <a class="btn secondary" href={safe} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export function Info({ children }: { children: ComponentChildren }) {
  const [open, setOpen] = useState(false);
  return (
    <span class="info">
      <button type="button" class="info-btn" aria-label="הסבר" aria-expanded={open} onClick={() => setOpen(!open)}>
        i
      </button>
      {open && <span class="info-text">{children}</span>}
    </span>
  );
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      class="btn secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement('textarea');
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        setDone(true);
        setTimeout(() => setDone(false), 2000);
      }}
    >
      {done ? 'הועתק ✓' : label}
    </button>
  );
}

export function Modal({ children }: { children: ComponentChildren }) {
  return (
    <div class="modal-back" role="dialog" aria-modal="true">
      <div class="modal">{children}</div>
    </div>
  );
}

/** קישוט עדין וכללי: שביל מקווקו, סיכת מיקום וצעדים. לא נושאי. */
export function TripDecor() {
  return (
    <svg class="trip" viewBox="0 0 120 40" aria-hidden="true" focusable="false">
      <path d="M6 32 C 26 6, 52 38, 82 14" fill="none" stroke="#c9d0ff" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="1 7" />
      <ellipse cx="22" cy="29" rx="3" ry="4.5" transform="rotate(-25 22 29)" fill="#dde2ff" />
      <ellipse cx="38" cy="24" rx="3" ry="4.5" transform="rotate(20 38 24)" fill="#dde2ff" />
      <ellipse cx="55" cy="26" rx="3" ry="4.5" transform="rotate(-20 55 26)" fill="#dde2ff" />
      <path d="M96 4 c-5 0-9 4-9 9 0 7 9 15 9 15 s9-8 9-15 c0-5-4-9-9-9z" fill="#5664d8" opacity="0.85" />
      <circle cx="96" cy="13" r="3.2" fill="#fff" />
    </svg>
  );
}

export function Credit() {
  return (
    <p class="credit">
      נוצר על ידי ד״ר אורי העליון
      <br />
      <small class="build">גרסה {typeof __BUILD__ === 'string' ? __BUILD__ : 'dev'}</small>
    </p>
  );
}
