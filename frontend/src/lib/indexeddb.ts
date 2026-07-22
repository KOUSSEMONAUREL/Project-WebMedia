import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'webmediia';
const DB_VERSION = 1;

let _db: IDBPDatabase | null = null;

async function getDb(): Promise<IDBPDatabase> {
  if (_db) return _db;
  _db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('favorites')) {
        db.createObjectStore('favorites', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('watchlist')) {
        db.createObjectStore('watchlist', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('history')) {
        db.createObjectStore('history', { keyPath: 'mediaId' });
      }
      if (!db.objectStoreNames.contains('reviews_offline')) {
        db.createObjectStore('reviews_offline', { keyPath: 'id' });
      }
    },
  });
  return _db;
}

export interface Favorite {
  id: string;
  type: string;
  title: string;
  slug: string;
  posterUrl?: string;
  rating?: number;
  year?: number;
  addedAt: number;
}

export interface HistoryEntry {
  mediaId: string;
  type: string;
  title: string;
  slug: string;
  posterUrl?: string;
  visitedAt: number;
}

export interface OfflineReview {
  id: string;
  mediaId: string;
  rating: number;
  comment?: string;
  synced: boolean;
  createdAt: number;
}

export async function addFavorite(item: Omit<Favorite, 'addedAt'>): Promise<void> {
  const db = await getDb();
  await db.put('favorites', { ...item, addedAt: Date.now() });
}

export async function removeFavorite(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('favorites', id);
}

export async function isFavorite(id: string): Promise<boolean> {
  const db = await getDb();
  const item = await db.get('favorites', id);
  return !!item;
}

export async function getAllFavorites(): Promise<Favorite[]> {
  const db = await getDb();
  return db.getAll('favorites');
}

export async function addToWatchlist(item: Omit<Favorite, 'addedAt'>): Promise<void> {
  const db = await getDb();
  await db.put('watchlist', { ...item, addedAt: Date.now() });
}

export async function removeFromWatchlist(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('watchlist', id);
}

export async function isInWatchlist(id: string): Promise<boolean> {
  const db = await getDb();
  const item = await db.get('watchlist', id);
  return !!item;
}

export async function getWatchlist(): Promise<Favorite[]> {
  const db = await getDb();
  return db.getAll('watchlist');
}

export async function addToHistory(entry: Omit<HistoryEntry, 'visitedAt'>): Promise<void> {
  const db = await getDb();
  const existing = await db.get('history', entry.mediaId);
  if (existing) {
    await db.put('history', { ...entry, visitedAt: Date.now() });
  } else {
    await db.put('history', { ...entry, visitedAt: Date.now() });
  }
}

export async function getHistory(limit: number = 50): Promise<HistoryEntry[]> {
  const db = await getDb();
  const all = await db.getAll('history');
  return all.sort((a, b) => b.visitedAt - a.visitedAt).slice(0, limit);
}

export async function saveOfflineReview(review: Omit<OfflineReview, 'synced' | 'createdAt'>): Promise<void> {
  const db = await getDb();
  await db.put('reviews_offline', { ...review, synced: false, createdAt: Date.now() });
}

export async function getUnsyncedReviews(): Promise<OfflineReview[]> {
  const db = await getDb();
  const all = await db.getAll('reviews_offline');
  return all.filter(r => !r.synced);
}

export async function markReviewSynced(id: string): Promise<void> {
  const db = await getDb();
  const review = await db.get('reviews_offline', id);
  if (review) {
    review.synced = true;
    await db.put('reviews_offline', review);
  }
}

export async function migrateFromLocalStorage(): Promise<void> {
  try {
    const favRaw = localStorage.getItem('webmedia_favorites:v1');
    if (favRaw) {
      const ids: string[] = JSON.parse(favRaw);
      await Promise.all(ids.map(async (id) => {
        const exists = await isFavorite(id);
        if (!exists) {
          await addFavorite({ id, type: '', title: '', slug: '' });
        }
      }));
      localStorage.removeItem('webmedia_favorites:v1');
    }
    const wlRaw = localStorage.getItem('webmedia_watchlist:v1');
    if (wlRaw) {
      const ids: string[] = JSON.parse(wlRaw);
      await Promise.all(ids.map(async (id) => {
        const exists = await isInWatchlist(id);
        if (!exists) {
          await addToWatchlist({ id, type: '', title: '', slug: '' });
        }
      }));
      localStorage.removeItem('webmedia_watchlist:v1');
    }
    console.log('[indexeddb] migrated from localStorage');
  } catch (err) {
    console.warn('[indexeddb] migration error:', err);
  }
}

export async function clearFavorites(): Promise<void> {
  const db = await getDb();
  await db.clear('favorites');
}

export async function clearWatchlist(): Promise<void> {
  const db = await getDb();
  await db.clear('watchlist');
}
