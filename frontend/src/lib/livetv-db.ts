import { openDB } from 'idb';

const DB_NAME = 'webmedia-livetv';
const DB_VERSION = 1;

let _db: any = null;

async function getDb() {
  if (_db) return _db;
  _db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('cache')) {
        db.createObjectStore('cache');
      }
    },
  });
  return _db;
}

export async function saveLivetvCache(key: string, data: any) {
  try {
    const db = await getDb();
    await db.put('cache', data, key);
  } catch {}
}

export async function loadLivetvCache(key: string) {
  try {
    const db = await getDb();
    return db.get('cache', key);
  } catch {
    return undefined;
  }
}
