/** עטיפה דקה ל-IndexedDB. שגיאות (למשל QuotaExceeded) מועברות הלאה — הקוראים מציגים אותן. */
const DB_NAME = 'treasure-hunt';
const STORES = ['blobs', 'draft', 'progress', 'games'] as const;
export type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    }).catch((e) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        let result: unknown;
        if (req) req.onsuccess = () => (result = req.result);
        t.oncomplete = () => resolve(result as T);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error ?? new Error('transaction aborted'));
      }),
  );
}

export const idbGet = <T>(store: StoreName, key: string) => tx<T | undefined>(store, 'readonly', (s) => s.get(key));
export const idbPut = (store: StoreName, key: string, value: unknown) => tx<void>(store, 'readwrite', (s) => s.put(value, key));
export const idbDel = (store: StoreName, key: string) => tx<void>(store, 'readwrite', (s) => s.delete(key));
export const idbDelPrefix = (store: StoreName, prefix: string) =>
  tx<void>(store, 'readwrite', (s) => s.delete(IDBKeyRange.bound(prefix, prefix + '￿')));
export const idbKeys = (store: StoreName) => tx<string[]>(store, 'readonly', (s) => s.getAllKeys() as IDBRequest);

export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export function isQuotaError(e: unknown): boolean {
  const err = e as { name?: string };
  return err?.name === 'QuotaExceededError' || err?.name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

export function describeStorageError(e: unknown): string {
  return isQuotaError(e)
    ? 'אין מספיק מקום פנוי בטלפון, ולכן השינוי האחרון לא נשמר. הפיקו דוח עכשיו, או פנו מקום ונסו שוב.'
    : 'לא הצלחנו לשמור במכשיר (ייתכן שהגלישה פרטית). השינוי האחרון לא נשמר — הפיקו דוח כדי לא לאבד עבודה.';
}
