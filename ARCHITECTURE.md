# Architecture WebMedia

## Vue d'ensemble

```
                        ┌─────────────────────────────────┐
                        │    SQLite statique (WASM)         │
                        │    GitHub Pages / CDN             │◄─── Frontend lit directement
                        │    Catalogue + Épisodes + Liens   │     (Range Requests, 0 backend)
                        │    Rebuild toutes les 1h          │
                        └──────────────┬───────────────────┘
                                       │
┌────────────────────────┐   ┌────────┴────────┐   ┌──────────────────┐
│    IndexedDB / OPFS    │   │  Service Worker  │   │  Cloudflare CDN  │
│    (données user       │◄──┤  + Cache API     │   │  (edge cache)    │
│     locales)           │   │  stale-while-    │   │  5 min TTL       │
│                        │   │  revalidate      │   │                  │
│  - Favoris             │   │                  │   │  - Réponses API  │
│  - Historique          │   │  - Cache pages   │   │  - Fichiers      │
│  - ContinueWatch       │   │  - Offline-ready │   │  statiques       │
│  - Reviews             │   │  - Intercepte    │   │                  │
│  - Sync Supabase (BG)  │   │    /api/*        │   │                  │
└────────────────────────┘   └────────┬─────────┘   └────────┬─────────┘
                                      │                       │
                              ┌───────┴───────────────────────┴────────┐
                              │        BACKEND (Hono / CF Worker)       │
                              │                                         │
                              │  - Auth / Login / User CRUD (Supabase) │
                              │  - Reviews / Favoris RW    (Supabase)  │
                              │  - User data API           (Supabase)  │
                              │  - Catalogue fallback      (Turso RO)  │
                              │  - Orchestrateur           (D1)        │
                              │  - Cache-Control headers                │
                              └────────────────┬────────────────────────┘
                                               │
                                        ┌──────┴──────┐
                                        │    TURSO    │
                                        │  LECTURE    │
                                        │  SEULEMENT  │
                                        │             │
                                        │  - Replica  │
                                        │    catalogue │
                                        │  - Sync     │
                                        │    depuis    │
                                        │    Neon      │
                                        └──────┬──────┘
                                               │ sync auto
                                        ┌──────┴──────┐
                                        │    NEON     │
                                        │  60h/mois   │
                                        │             │
                                        │  - Source   │
                                        │    vérité   │
                                        │  - Importers│
                                        │  - Scrapers │
                                        └─────────────┘
```

## Principe fondateur

**95 % des requêtes ne touchent jamais le backend.** Le frontend utilise 3 couches locales avant d'atteindre le réseau :

1. **SQLite WASM** (catalogue statique) → Zéro requête réseau pour le catalogue
2. **IndexedDB** (données utilisateur) → Zéro requête réseau pour favoris/historique/reviews
3. **Service Worker** (cache API) → Zéro requête réseau si déjà chargé

**Supabase** est le backend de vérité pour toutes les données utilisateur (lecture + écriture).
**Turso** est un replica read-only du catalogue, alimenté par Neon.
**Neon** n'est plus que la source de vérité pour les importers/scrapers.

---

## 1. SQLite WASM — Catalogue statique

### Concept

Un fichier `.sqlite` pré-généré depuis Neon est déployé comme fichier statique sur GitHub Pages / Cloudflare Pages. Le navigateur le lit directement via **HTTP Range Requests** : il ne télécharge que les pages SQLite nécessaires à la requête (grâce aux index B-Tree). Une recherche retourne les résultats en transférant ~1 Ko, même sur une base de 500 Mo.

### Contenu du fichier

| Table          | Contenu                                                                          | Index                                                                        |
| -------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `medias`     | Tout le catalogue (titre, poster, synopsis, année, note, slug, ids externes...) | `id`, `slug`, `type`, `year`, `title`, `anilist_id`, `tmdb_id` |
| `episodes`   | Épisodes/saisons liés aux médias                                              | `id`, `media_id`                                                         |
| `liens`      | URLs de streaming, sources                                                       | `id`, `media_id`, `player_host`                                        |
| `id_mapping` | Correspondances anilist↔tmdb↔mal↔imdb                                         | `anilist_id`, `tmdb_id`                                                  |

### Génération (GitHub Actions)

```yaml
name: Build SQLite catalogue
on:
  schedule:
    - cron: '0 * * * *'   # toutes les heures
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Export Neon → SQLite
        run: |
          pip install pg2sqlite
          pg2sqlite \
            --pg-url "$NEON_DATABASE_URL" \
            --sqlite-path catalogue.sqlite \
            --tables medias,episodes,liens,id_mapping
      - name: Optimize
        run: |
          sqlite3 catalogue.sqlite "
            CREATE INDEX IF NOT EXISTS idx_medias_type ON medias(type);
            CREATE INDEX IF NOT EXISTS idx_medias_title ON medias(title);
            CREATE INDEX IF NOT EXISTS idx_medias_slug ON medias(slug);
            CREATE INDEX IF NOT EXISTS idx_episodes_media ON episodes(media_id);
            CREATE INDEX IF NOT EXISTS idx_liens_media ON liens(media_id);
            PRAGMA journal_mode=WAL;
            PRAGMA page_size=4096;
            VACUUM;
          "
      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v4
        with:
          publish_dir: .
          publish_branch: gh-pages
          destination_dir: data
```

### Chargement côté frontend

```typescript
import initSqlJs from 'sql.js';
const SQL = await initSqlJs({ locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@1/dist/${file}` });

const response = await fetch('https://username.github.io/repo/data/catalogue.sqlite');
const buffer = await response.arrayBuffer();
const db = new SQL.Database(new Uint8Array(buffer));

function searchMedia(query: string, type?: string) {
  const sql = `SELECT * FROM medias
    WHERE title LIKE ? ${type ? 'AND type = ?' : ''}
    LIMIT 20 OFFSET 0`;
  const params = type ? [`%${query}%`, type] : [`%${query}%`];
  return db.exec(sql, params);
}
```

### Conséquence

Toutes ces routes GET catalogue sont **supprimées du backend** (le frontend exécute localement) :

- `GET /api/search`
- `GET /api/media/:id`
- `GET /api/media?type=`
- `GET /api/media/list`
- `GET /api/episodes/:mediaId`
- `GET /api/liens/:mediaId`

**Économie :** 100 % des requêtes catalogue → 0 call backend, 0 call Neon, 0 call Turso.

---

## 2. IndexedDB — Données utilisateur locales (LEVIER #1)

C'est **le levier le plus important** pour supprimer des requêtes réseau. Les données personnelles de l'utilisateur (favoris, historique, reviews, continueWatch) sont stockées dans IndexedDB. Le frontend lit et écrit localement. La synchronisation avec Supabase se fait en arrière-plan.

### Schéma IndexedDB

```
📁 webmedia (database)
├── 📂 favorites
│   ├── { mediaId: "uuid", addedAt: timestamp, ... }
│   └── index: mediaId, addedAt
├── 📂 history
│   ├── { mediaId: "uuid", lastVisitedAt: timestamp, episodeId?: "uuid" }
│   └── index: lastVisitedAt
├── 📂 continueWatch
│   ├── { mediaId: "uuid", episodeId: "uuid", progress: 0.65, updatedAt: timestamp }
│   └── index: updatedAt
├── 📂 reviews
│   ├── { mediaId: "uuid", rating: 8, comment: "...", spoiler: false }
│   └── index: mediaId
├── 📂 userProfile
│   ├── { username: "...", avatar: "...", preferences: {...} }
│   └── index: (singleton)
└── 📂 pendingSync
    └── { operations: [...] }  // file d'attente si offline
```

### Flux complet

```
1. LOGIN
   │
   ├── POST /api/auth/login → token JWT + user info
   │
   ├── GET /api/user/data → { favorites, history, reviews, profile }
   │   (un seul appel batch, retourne TOUT l'état utilisateur)
   │
   └── Stocke tout dans IndexedDB (cache 24h ou jusqu'à modification)

2. NAVIGATION (page d'accueil)
   │
   ├── IndexedDB.get("favorites")         → 0ms, local
   ├── IndexedDB.get("history")           → 0ms, local
   ├── IndexedDB.get("continueWatch")     → 0ms, local
   └── SQLite WASM → médias populaires    → 0-50ms, Range Request
   │
   └── ❌ ZÉRO requête réseau

3. ACTION (ex: ajouter un favori)
   │
   ├── 1. IndexedDB.put("favorites", item)    → UI instantanée (0ms)
   │
   └── 2. POST /api/user/favorites (arrière-plan, timeout 5s)
         │
         └── Si succès → Supabase mis à jour
         └── Si échec → reste dans pendingSync, retry plus tard

4. NOUVEL ONGLET / REVISITE (24h plus tard)
   │
   ├── IndexedDB.get("favorites") → toujours dispo (0ms)
   │
   └── Sync arrière-plan : GET /api/user/data?since=<timestamp>
       → récupère uniquement les changements depuis la dernière sync
```

### Synchronisation arrière-plan

```typescript
// Enregistrement de la sync périodique
if ('serviceWorker' in navigator && 'SyncManager' in window) {
  navigator.serviceWorker.ready.then(reg => {
    reg.sync.register('sync-user-data');
  });
}

// Service Worker : sync périodique (toutes les 5 min si changes)
self.addEventListener('sync', event => {
  if (event.tag === 'sync-user-data') {
    event.waitUntil(syncPendingToSupabase());
  }
});

async function syncPendingToSupabase() {
  const pending = await readPendingOps();
  if (pending.length === 0) return;

  // Batch unique au lieu de N requêtes
  await fetch('/api/user/sync', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ operations: pending })
  });
  await clearPendingOps();
}
```

### API backend pour la sync

```typescript
// POST /api/user/sync — batch les mutations offline
app.post('/api/user/sync', async (c) => {
  const userId = c.get('jwtPayload').id;
  const { operations } = await c.req.json();

  for (const op of operations) {
    switch (op.type) {
      case 'add-favorite':
        await supabase.insert(favorites).values({ userId, mediaId: op.mediaId });
        break;
      case 'remove-favorite':
        await supabase.delete(favorites).where(and(eq(favorites.userId, userId), eq(favorites.mediaId, op.mediaId)));
        break;
      case 'update-review':
        await supabase.update(reviews).set({ rating: op.rating, comment: op.comment })
          .where(and(eq(reviews.userId, userId), eq(reviews.mediaId, op.mediaId)));
        break;
      // ...
    }
  }
  return c.json({ success: true, synced: operations.length });
});

// GET /api/user/data — retourne tout l'état utilisateur (1 seul appel)
app.get('/api/user/data', async (c) => {
  const userId = c.get('jwtPayload').id;
  const [favorites, history, reviews, profile] = await Promise.all([
    supabase.select().from(favorites).where(eq(favorites.userId, userId)),
    supabase.select().from(history).where(eq(history.userId, userId)),
    supabase.select().from(reviews).where(eq(reviews.userId, userId)),
    supabase.select().from(users).where(eq(users.id, userId)).limit(1),
  ]);
  return c.json({ favorites, history, reviews, profile: profile[0] });
});
```

### Conséquence

- **Zéro requête réseau** pour afficher les favoris, l'historique, les recommendations personnalisées
- **Zéro requête réseau** pour les reviews de l'utilisateur
- **Offline-ready** : l'utilisateur navigue et modifie ses données sans connexion
- **Sync groupée** : au lieu de 50 petits POST, un seul POST batch toutes les 5 min
- **Supabase bandwidth :** ~10 requêtes/jour par user au lieu de ~100

---

## 3. Service Worker + Cache API

### Concept

Le Service Worker intercepte tous les appels vers `/api/*` et applique une stratégie **cache-first avec stale-while-revalidate** pour les réponses GET. Les réponses sont servies instantanément depuis le cache, et mises à jour en arrière-plan si le cache est expiré.

### Stratégie par type de route

| Route                   | Stratégie              | TTL                       | Note                                |
| ----------------------- | ----------------------- | ------------------------- | ----------------------------------- |
| `GET /api/media/*`    | **Cache-first**   | 5 min                     | Fallback si SQLite WASM pas chargé |
| `GET /api/search*`    | **Cache-first**   | 5 min                     | Fallback si SQLite WASM pas chargé |
| `GET /api/episodes/*` | **Cache-first**   | 5 min                     | Fallback si SQLite WASM pas chargé |
| `GET /api/user/data`  | **Network-first** | 24h (invalidation locale) | Données personnelles               |
| `POST /api/*`         | **Network-only**  | -                         | Écritures                          |
| `GET /api/internal/*` | **Network-only**  | -                         | Clé API requise                    |

```javascript
const CACHE_NAME = 'webmedia-v1';
const API_CACHE_TTL = 5 * 60 * 1000;

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(cacheFirst(event.request));
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    const age = Date.now() - new Date(cached.headers.get('sw-cache-date') || 0).getTime();
    if (age < API_CACHE_TTL) return cached;
    fetchAndUpdate(request, cache);
    return cached;
  }
  return fetchAndUpdate(request, cache);
}
```

---

## 4. Turso — Replica catalogue read-only

### Rôle

Turso est un **replica read-only** du catalogue, synchronisé depuis Neon. Il sert uniquement à :

- **Backend fallback** : si SQLite WASM n'est pas encore chargé ou pour les requêtes qui nécessitent des données fraîches
- **Recommandations pré-calculées** : générées par un job et stockées dans Turso
- **Aucune écriture** : ni depuis le frontend, ni depuis le backend

### Flux

```
Neon (importers écrivent)
  │
  └── sync-turso.ts (déjà existant) ──▶ Turso (read-only)
                                          │
                                     Backend lit depuis Turso
                                          │
                                     Cache-Control → CDN → Service Worker
```

### Connexion backend

```typescript
import { createClient } from '@libsql/client';

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

// Fallback si SQLite WASM n'est pas utilisé
app.get('/api/media/trending', async (c) => {
  const rows = await turso.execute('SELECT * FROM medias ORDER BY rating DESC LIMIT 20');
  c.header('Cache-Control', 'public, max-age=300');
  return c.json({ success: true, data: rows });
});
```

### Plafond

1 000 000 000 reads/mois pour cette seule utilisation (fallback + recommandations). Pour 1000 utilisateurs × 10 requêtes/jour : 300K reads/mois. Soit **0,03 % du plafond**.

---

## 5. Supabase — Backend utilisateur (lecture + écriture)

### Rôle

Supabase est **le backend de vérité pour toutes les données utilisateur** :

| Donnée                  | Lecture                 | Écriture                   |
| ------------------------ | ----------------------- | --------------------------- |
| `users` (auth, profil) | Supabase                | Supabase                    |
| `favorites`            | Supabase (→ IndexedDB) | Supabase (depuis IndexedDB) |
| `history`              | Supabase (→ IndexedDB) | Supabase (depuis IndexedDB) |
| `continueWatch`        | Supabase (→ IndexedDB) | Supabase (depuis IndexedDB) |
| `reviews`              | Supabase (→ IndexedDB) | Supabase (depuis IndexedDB) |
| `scraping_jobs`        | Supabase                | Orchestrator uniquement     |

### API backend

```typescript
// GET /api/user/data — batch unique pour tout l'état user
app.get('/api/user/data', async (c) => {
  const userId = c.get('jwtPayload').id;
  const [favorites, history, reviews, profile] = await Promise.all([
    supabase.select().from(favorites).where(eq(favorites.userId, userId)),
    supabase.select().from(history).where(eq(history.userId, userId)),
    supabase.select().from(reviews).where(eq(reviews.userId, userId)),
    supabase.select().from(users).where(eq(users.id, userId)).limit(1),
  ]);
  return c.json({ success: true, data: { favorites, history, reviews, profile: profile[0] } });
});

// POST /api/user/sync — sync batch des mutations
app.post('/api/user/sync', async (c) => {
  const userId = c.get('jwtPayload').id;
  const { operations } = await c.req.json();
  const results = [];
  for (const op of operations) {
    try {
      // chaque opération est indépendante (try/catch individuel)
      results.push(await applyOperation(userId, op));
    } catch (err) {
      results.push({ op, error: err.message });
    }
  }
  return c.json({ success: true, synced: results.filter(r => !r.error).length, errors: results.filter(r => r.error) });
});
```

### Anti-sommeil

Le plan gratuit de Supabase endort la base après 1 semaine d'inactivité. Avec des utilisateurs actifs qui lisent/écrivent via IndexedDB sync, la base ne s'endort jamais (requêtes quotidiennes). Mais pour les périodes creuses :

```yaml
name: Keep Supabase alive
on:
  schedule:
    - cron: '0 */6 * * *'
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - run: curl -s "https://${{ secrets.SUPABASE_URL }}/rest/v1/" > /dev/null
```

### Bande passante Supabase

| Scénario                                   | Requêtes/jour avant | Requêtes/jour après        |
| ------------------------------------------- | -------------------- | ---------------------------- |
| Login                                       | 1                    | 1                            |
| GET /api/user/data                          | ~10 (dispersées)    | **1** (batch au login) |
| Sync mutations                              | -                    | ~5 (batch toutes les 5 min)  |
| Reviews des autres users (lecture publique) | ~5                   | **0** (SQLite WASM)    |
| **Total**                             | **~16**        | **~7**                 |

Soit 7 requêtes/jour × 1000 users × 30 jours = **210 000 requêtes/mois**. Dans les 5 Go de bande passante : largement ok.

---

## 6. Neon — Source de vérité (importers uniquement)

### Rôle

Neon devient **uniquement** la base des importers et scrapers :

- Les importers (TMDB, AniList, MangaDex, RoyalRoad, etc.) écrivent dans Neon
- Neon sync vers Turso (read-only) via `sync-turso.ts`
- Neon sync vers SQLite WASM via le job GH Actions
- **Plus aucune route frontend, aucun utilisateur ne lit Neon**

### Impact

| Métrique                    | Avant        | Après    |
| ---------------------------- | ------------ | --------- |
| Compute Neon utilisé        | 40-50h/mois  | < 5h/mois |
| Requêtes frontend vers Neon | 30 000+/jour | 0         |

---

## 7. D1 — Orchestration uniquement

### Rôle

D1 ne sert plus que pour `media_state` (orchestrateur des scraping jobs).

- `SELECT * FROM media_state WHERE next_scrape < ?` — quelques centaines de reads par run d'orchestration
- `UPDATE media_state SET ...` — autant d'écritures que de jobs créés
- **Plus aucune route frontend ne lit D1**

### Impact

| Métrique | Avant      | Après     |
| --------- | ---------- | ---------- |
| Reads D1  | > 1M/jour  | < 50K/jour |
| Writes D1 | > 10K/jour | < 5K/jour  |

---

## Synthèse : qui sert quoi

| Base de données           | Type             | Sert à                                                     | Read/mois gratuits | Écritures         | Risque       |
| -------------------------- | ---------------- | ----------------------------------------------------------- | ------------------ | ------------------ | ------------ |
| **SQLite (.sqlite)** | Fichier statique | Catalogue frontend (médias, épisodes, liens)              | Illimité (CDN)    | 0                  | Aucun        |
| **IndexedDB**        | Navigateur       | Données utilisateur locales (favoris, historique, reviews) | Illimité (local)  | Synced à Supabase | Aucun        |
| **Turso**            | SQLite edge      | Replica catalogue read-only (fallback backend)              | 1B/mois            | 0                  | Négligeable |
| **Supabase**         | PostgreSQL       | Données utilisateur (auth, favoris, reviews, profil)       | 5 Go BW/mois       | Oui (via API)      | Faible       |
| **Neon**             | PostgreSQL       | Importers / scrapers (source de vérité)                   | 60h compute        | Oui (importers)    | < 5h/mois    |
| **D1**               | SQLite edge      | Orchestration`media_state`                                | 5M/jour            | Oui (orchestrator) | 50K/jour     |
| **Cloudflare KV**    | Edge KV          | Verrouillage orchestrateur (1 write/run)                    | 100K/jour          | 1K/jour            | Très faible |
| **Service Worker**   | Cache navigateur | Cache des réponses API (fallback)                          | Illimité          | 0                  | Aucun        |

## Flow complet pour une page d'accueil

```
1. USER ARRIVE SUR WEBMEDIA.COM
   │
   ├── SW → vérifie le cache local
   ├── IndexedDB → charge favoris + historique + continueWatch  (0ms, local)
   ├── SQLite WASM → charge 20 médias populaires               (0-50ms, Range Request)
   │                   SELECT * FROM medias ORDER BY rating DESC LIMIT 20
   ├── IndexedDB → recommendés basés sur l'historique           (0ms, local JS)
   │
   └── ⚡ ZÉRO appel backend, ZÉRO appel DB distante

2. USER CLIQUE SUR UN MÉDIA
   │
   ├── SQLite WASM → détails du média + épisodes + liens       (0-10ms)
   ├── IndexedDB → review de l'user si existe                   (0ms)
   │
   └── ⚡ ZÉRO appel backend

3. USER AJOUTE UN FAVORI
   │
   ├── IndexedDB.put → écrit instantanément, UI update         (0ms)
   └── sync arrière-plan → POST /api/user/sync vers Supabase   (50-200ms)
       │
       └── ⚡ 1 SEULE requête réseau (mutations groupées)

4. USER SE DÉCONNECTE / NOUVEL APPAREIL
   │
   ├── POST /api/auth/login                                     (1 requête)
   ├── GET /api/user/data → batch complet de l'état user        (1 requête)
   │   → stocke dans IndexedDB
   │
   └── ⚡ 2 REQUÊTES RÉSEAU (login + sync initiale)
```

## Application : compteur de requêtes réseau

| Action                          | Requêtes réseau                 | DB touchée             |
| ------------------------------- | --------------------------------- | ----------------------- |
| Navigation catalogue (10 pages) | **0**                       | SQLite WASM + IndexedDB |
| Recherche (5 essais)            | **0**                       | SQLite WASM             |
| Page détail média             | **0**                       | SQLite WASM             |
| Voir ses favoris                | **0**                       | IndexedDB               |
| Voir son historique             | **0**                       | IndexedDB               |
| Ajouter un favori               | **1** (async)               | Supabase                |
| Poster une review               | **1** (async)               | Supabase                |
| Login                           | **1**                       | Supabase                |
| Sync initiale (login)           | **1**                       | Supabase                |
| Sync périodique (5 min)        | **1** (mutations groupées) | Supabase                |

**Total pour 100 pages vues + 10 actions : 3-5 requêtes réseau.**
**Dont 0 vers Neon, 0 vers D1, 0 vers Turso.**
**Uniquement vers Supabase pour les données utilisateur.**

## Ordre d'implémentation

### Phase 1 — Cache-Control headers (15 min)

Ajouter `Cache-Control: public, max-age=300, s-maxage=300` sur toutes les routes GET du backend. Le CDN Cloudflare éponge la majorité du trafic sans effort.

### Phase 2 — IndexedDB + Supabase User API (2-3 jours)

- Créer l'API Supabase pour les données utilisateur : `GET /api/user/data`, `POST /api/user/sync`
- Implémenter IndexedDB côté frontend (favoris, historique, continueWatch, reviews)
- Flux optimistic + sync arrière-plan
- **C'est le levier #1 : supprime 80% des requêtes réseau**

### Phase 3 — Service Worker (1 jour)

- Créer `sw.js` avec stratégie cache-first + stale-while-revalidate
- Registre dans Astro/Next.js
- Cache des réponses API restantes

### Phase 4 — SQLite WASM (3-4 jours)

- GitHub Actions exporte Neon → `.sqlite` avec index
- Déploie sur GitHub Pages / Cloudflare Pages
- Frontend : remplace tous les appels catalogue par des queries WASM
- Backend : retire les routes GET catalogue (désormais inutiles)

### Phase 5 — Recommandations pré-calculées (1-2 jours)

- Job GH Actions calcule les recommandations par cluster d'utilisateurs
- Stocke dans un fichier JSON statique sur le CDN
- Frontend les lit depuis le fichier statique
