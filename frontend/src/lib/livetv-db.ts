import { openDB } from 'idb';

const DB_NAME = 'webmediia-livetv';
const DB_VERSION = 2;

let _db: any = null;

async function getDb() {
  if (_db) return _db;
  _db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVer) {
      if (oldVer < 1) {
        db.createObjectStore('cache');
      }
      if (oldVer < 2) {
        db.createObjectStore('stream-checks', { keyPath: 'url' });
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

const CHECK_TTL = 30 * 60 * 1000;

export async function saveStreamCheck(url: string, alive: boolean) {
  try {
    const db = await getDb();
    await db.put('stream-checks', { url, alive, ts: Date.now() });
  } catch {}
}

export async function loadStreamCheck(url: string): Promise<{ alive: boolean } | null> {
  try {
    const db = await getDb();
    const entry = await db.get('stream-checks', url);
    if (!entry) return null;
    if (Date.now() - entry.ts > CHECK_TTL) return null;
    return { alive: entry.alive };
  } catch {
    return null;
  }
}

export async function loadStreamChecksBatch(urls: string[]): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();
  try {
    const db = await getDb();
    const entries = await Promise.all(urls.map(url => db.get('stream-checks', url)));
    for (let i = 0; i < urls.length; i++) {
      const entry = entries[i];
      if (entry && Date.now() - entry.ts <= CHECK_TTL) {
        results.set(urls[i], entry.alive);
      }
    }
  } catch {}
  return results;
}

async function getCachedAliveChannelIds(channelUrls: Map<string, string[]>): Promise<Set<string>> {
  const alive = new Set<string>();
  for (const [chId, urls] of channelUrls) {
    for (const url of urls) {
      const result = await loadStreamCheck(url);
      if (result?.alive) { alive.add(chId); break; }
    }
  }
  return alive;
}
