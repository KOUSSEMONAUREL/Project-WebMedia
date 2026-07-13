const DB_NAME = 'webmedia-api-cache';
const DB_VERSION = 1;
const STORE = 'responses';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function cacheGet<T>(key: string, ttlMs: number): Promise<T | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    return new Promise(resolve => {
      req.onsuccess = () => {
        const entry = req.result;
        if (!entry || Date.now() - entry.ts > ttlMs) {
          resolve(null);
        } else {
          resolve(entry.data as T);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

export async function cacheSet<T>(key: string, data: T): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ data, ts: Date.now() }, key);
  } catch { /* silent */ }
}
