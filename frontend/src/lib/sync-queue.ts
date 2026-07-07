const SYNC_DELAY_MS = 15 * 60 * 1000;
const SESSION_START_KEY = 'webmedia_session_start';
const PENDING_FAVS_KEY = 'webmedia_pending_favs';
const PENDING_HISTORY_KEY = 'webmedia_pending_history';

interface PendingFavOp {
  action: 'add' | 'remove';
  timestamp: number;
}

interface PendingHistoryEntry {
  mediaId: string;
  type: string;
  title: string;
  slug: string;
  posterUrl?: string;
  visitedAt: number;
}

function getSessionStart(): number {
  if (typeof sessionStorage === 'undefined') return Date.now();
  const stored = sessionStorage.getItem(SESSION_START_KEY);
  if (stored) return parseInt(stored, 10);
  const now = Date.now();
  sessionStorage.setItem(SESSION_START_KEY, String(now));
  return now;
}

function loadPendingFavs(): Map<string, PendingFavOp> {
  if (typeof sessionStorage === 'undefined') return new Map();
  try {
    const raw = sessionStorage.getItem(PENDING_FAVS_KEY);
    if (!raw) return new Map();
    return new Map(JSON.parse(raw) as [string, PendingFavOp][]);
  } catch { return new Map(); }
}

function savePendingFavs(ops: Map<string, PendingFavOp>): void {
  if (typeof sessionStorage === 'undefined') return;
  if (ops.size === 0) {
    sessionStorage.removeItem(PENDING_FAVS_KEY);
  } else {
    sessionStorage.setItem(PENDING_FAVS_KEY, JSON.stringify([...ops.entries()]));
  }
}

function loadPendingHistory(): PendingHistoryEntry[] {
  if (typeof sessionStorage === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(PENDING_HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch { return []; }
}

function savePendingHistory(entries: PendingHistoryEntry[]): void {
  if (typeof sessionStorage === 'undefined') return;
  if (entries.length === 0) {
    sessionStorage.removeItem(PENDING_HISTORY_KEY);
  } else {
    sessionStorage.setItem(PENDING_HISTORY_KEY, JSON.stringify(entries));
  }
}

async function flushPendingOps(): Promise<void> {
  const favOps = loadPendingFavs();
  const historyEntries = loadPendingHistory();
  if (favOps.size === 0 && historyEntries.length === 0) return;

  let token: string | null = null;
  try {
    const { getAuthToken } = await import('./auth-client');
    token = await getAuthToken();
  } catch {}
  if (!token) return;

  const apiBaseUrl = ((import.meta as any).env?.PUBLIC_API_URL || 'http://localhost:8787').replace(/\/+$/, '') + '/api';

  savePendingFavs(new Map());
  savePendingHistory([]);

  const body: any = {};

  if (favOps.size > 0) {
    body.favorites = [...favOps.entries()].map(([mediaId, op]) => ({
      mediaId, action: op.action,
    }));
  }

  if (historyEntries.length > 0) {
    body.history = historyEntries;
  }

  try {
    const res = await fetch(`${apiBaseUrl}/user/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(body),
      credentials: 'include',
    });
    if (res.ok) {
      const total = (favOps.size + historyEntries.length);
      console.info(`[sync-queue] ${total} operation(s) synchronisees en batch`);
    } else {
      console.warn('[sync-queue] echec sync batch:', res.status);
    }
  } catch (err) {
    console.warn('[sync-queue] erreur flush batch:', err);
  }
}

export function queueFavoriteSync(mediaId: string, action: 'add' | 'remove'): void {
  if (typeof sessionStorage === 'undefined') return;
  const ops = loadPendingFavs();
  ops.set(mediaId, { action, timestamp: Date.now() });
  savePendingFavs(ops);
}

export function queueHistorySync(entry: PendingHistoryEntry): void {
  if (typeof sessionStorage === 'undefined') return;
  const entries = loadPendingHistory().filter(e => e.mediaId !== entry.mediaId);
  entries.push(entry);
  savePendingHistory(entries);
}

export function initSyncSession(): void {
  if (typeof sessionStorage === 'undefined') return;

  const start = getSessionStart();
  const elapsed = Date.now() - start;

  if (elapsed >= SYNC_DELAY_MS) {
    flushPendingOps();
  } else {
    const remaining = SYNC_DELAY_MS - elapsed;
    const timer = setTimeout(() => flushPendingOps(), remaining);
    if (timer && typeof (timer as any).unref === 'function') {
      (timer as any).unref();
    }
  }

  if (typeof window !== 'undefined' && 'visibilitychange' in document) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flushPendingOps();
      }
    });
  }
}
