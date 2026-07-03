/**
 * sync-queue.ts
 * ─────────────────────────────────────────────────────────────
 * Stratégie "local-first, deferred remote":
 *  - Les favoris sont toujours écrits IMMÉDIATEMENT dans IndexedDB.
 *  - La synchronisation vers Supabase (via API Render) n'est déclenchée
 *    que si l'utilisateur est resté ≥ 15 minutes sur le site ET
 *    qu'il existe des opérations en attente.
 *  - sessionStorage est utilisé pour la persistance inter-pages:
 *    ses données sont effacées à la fermeture du tab → visiteur
 *    passager = 0 écriture en base distante.
 * ─────────────────────────────────────────────────────────────
 */

const SYNC_DELAY_MS = 15 * 60 * 1000; // 15 minutes
const SESSION_START_KEY = 'webmedia_session_start';
const PENDING_OPS_KEY   = 'webmedia_pending_favs';

interface PendingOp {
  action: 'add' | 'remove';
  timestamp: number;
}

// ─── Helpers sessionStorage ───────────────────────────────────

function getSessionStart(): number {
  if (typeof sessionStorage === 'undefined') return Date.now();
  const stored = sessionStorage.getItem(SESSION_START_KEY);
  if (stored) return parseInt(stored, 10);
  const now = Date.now();
  sessionStorage.setItem(SESSION_START_KEY, String(now));
  return now;
}

function loadPendingOps(): Map<string, PendingOp> {
  if (typeof sessionStorage === 'undefined') return new Map();
  try {
    const raw = sessionStorage.getItem(PENDING_OPS_KEY);
    if (!raw) return new Map();
    return new Map(JSON.parse(raw) as [string, PendingOp][]);
  } catch { return new Map(); }
}

function savePendingOps(ops: Map<string, PendingOp>): void {
  if (typeof sessionStorage === 'undefined') return;
  if (ops.size === 0) {
    sessionStorage.removeItem(PENDING_OPS_KEY);
  } else {
    sessionStorage.setItem(PENDING_OPS_KEY, JSON.stringify([...ops.entries()]));
  }
}

// ─── Flush vers Supabase ──────────────────────────────────────

async function flushPendingOps(): Promise<void> {
  const ops = loadPendingOps();
  if (ops.size === 0) return;

  try {
    const { getAuthToken } = await import('./auth-client');
    const token = await getAuthToken();
    if (!token) return; // Utilisateur non connecté → on ne tente pas

    const apiBaseUrl = (import.meta as any).env?.PUBLIC_API_URL || 'http://localhost:8787/api';

    // On vide la file avant les appels pour éviter un double-flush en cas d'erreur partielle
    savePendingOps(new Map());

    const reqs = [...ops.entries()].map(([mediaId, op]) => {
      if (op.action === 'add') {
        return fetch(`${apiBaseUrl}/user/favorites`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ mediaId }),
          credentials: 'include',
        });
      } else {
        return fetch(`${apiBaseUrl}/user/favorites/${mediaId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` },
          credentials: 'include',
        });
      }
    });

    await Promise.allSettled(reqs);
    console.info(`[sync-queue] ${ops.size} opération(s) synchronisée(s) avec Supabase`);
  } catch (err) {
    console.warn('[sync-queue] erreur lors du flush:', err);
  }
}

// ─── API publique ─────────────────────────────────────────────

/**
 * Ajoute ou met à jour une opération de favori dans la file.
 * La dernière action pour un même mediaId efface la précédente.
 */
export function queueFavoriteSync(mediaId: string, action: 'add' | 'remove'): void {
  if (typeof sessionStorage === 'undefined') return;

  const ops = loadPendingOps();
  ops.set(mediaId, { action, timestamp: Date.now() });
  savePendingOps(ops);
}

/**
 * À appeler une seule fois au chargement du site.
 * Démarre le compteur de 15 minutes et planifie le flush automatique.
 */
export function initSyncSession(): void {
  if (typeof sessionStorage === 'undefined') return;

  const start   = getSessionStart();
  const elapsed = Date.now() - start;

  if (elapsed >= SYNC_DELAY_MS) {
    // L'utilisateur a déjà dépassé les 15 minutes, flush immédiat
    flushPendingOps();
  } else {
    const remaining = SYNC_DELAY_MS - elapsed;
    setTimeout(() => flushPendingOps(), remaining);
    console.debug(`[sync-queue] flush planifié dans ${Math.round(remaining / 1000)}s`);
  }
}
