import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { createClient } from '@libsql/client';
import { getNeonDb } from '../db/singleton';
import { medias, episodes, liens } from '../db/neon/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { MediaState } from '../services/resolver';
import { logger } from '../services/logger';
import { OrchestratorService } from '../services/orchestrator';

type Bindings = {
    NEON_DATABASE_URL: string;
    HYPERDRIVE: Hyperdrive;
    INTERNAL_API_KEY: string;
    MONGODB_URI: string;
    TMDB_API_KEY: string;
    DB: D1Database;
    TURSO_DATABASE_URL?: string;
    TURSO_AUTH_TOKEN?: string;
};

const internalRoutes = new Hono<{ Bindings: Bindings }>();

// Helper universel pour les variables d'env
const getVar = (c: any, key: string) => {
    const val = c.env?.[key] || (process.env as any)[key];
    if (!val && (c.env?.ENVIRONMENT === 'production' || process.env.NODE_ENV === 'production')) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return val;
};

const mongoUri = (c: any) => {
    try { return getVar(c, 'MONGODB_URI'); } catch { return ''; }
};

// Middleware de sécurité
internalRoutes.use('*', async (c, next) => {
    const apiKey = c.req.header('X-Internal-API-Key');
    const secretKey = getVar(c, 'INTERNAL_API_KEY');
    if (!apiKey || apiKey !== secretKey) {
        return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
});

// Whitelist supprimée : le middleware X-Internal-API-Key suffit pour sécuriser l'endpoint.
// Tous les scrapers autorisés (streaming, novels, jeux, webtoons, comics) passent.

// ========== POST /api/internal/ingest/liens ==========
const ingestLiensSchema = z.object({
    mediaId: z.string().uuid(),
    episodeId: z.string().uuid().optional(),
    links: z.array(z.object({
        source_site: z.string(),
        player_host: z.string().optional(),
        url: z.union([z.string().url(), z.string().startsWith('magnet:'), z.string().min(1)]),
        qualite: z.string().optional(),
        langue: z.string().optional(),
        sous_titres: z.boolean().optional().default(false),
        headers: z.record(z.string(), z.string()).optional(),
        episode_id: z.string().uuid().optional(),
        episodeId: z.string().uuid().optional(),
    }))
});

// [DEBUG TEMP] Log body avant validation pour identifier les 400
internalRoutes.post('/ingest/liens', async (c, next) => {
    // Cloner la requête pour lire le body SANS le consommer
    const cloned = c.req.raw.clone();
    let parsed: any;
    try { parsed = await cloned.json(); } catch { parsed = null; }
    if (!parsed || !parsed.links || !Array.isArray(parsed.links)) {
        console.warn('[DEBUG /ingest/liens] Body invalide reçu:', JSON.stringify(parsed)?.slice(0, 500));
    }
    await next();
}, zValidator('json', ingestLiensSchema as any), async (c) => {
    const data = c.req.valid('json') as z.infer<typeof ingestLiensSchema>;
    const { mediaId, episodeId, links } = data;

    // Plus de filtrage par whitelist : le X-Internal-API-Key garantit que seuls
    // les scrapers autorisés peuvent poster. Tous les liens sont acceptés.
    const safeLinks = links;

    let inserted: any[] = [];
    try {
        const connStr = getVar(c, 'NEON_DATABASE_URL');
        const hyperdrive = c.env?.HYPERDRIVE;
        const db = getNeonDb(connStr, hyperdrive) as any;

        // Warm-up Hyperdrive : simple ping avant d'insérer pour réveiller la connexion
        try {
            await db.execute('SELECT 1');
        } catch {
            // Pas grave si le ping échoue, on tente quand même l'insert
        }

        // Retry 2x sur l'insert (cold start Hyperdrive)
        let lastInsertError: any;
        for (let attempt = 0; attempt <= 2; attempt++) {
            try {
                inserted = await db.insert(liens).values(
                    safeLinks.map(link => ({
                        sourceSite: link.source_site,
                        playerHost: link.player_host,
                        url: link.url,
                        quality: link.qualite || null,
                        language: link.langue || null,
                        hasSubtitles: link.sous_titres ?? false,
                        headers: link.headers || null,
                        mediaId,
                        episodeId: link.episode_id || link.episodeId || null,
                        scrapedAt: new Date()
                    }))
                ).returning();
                lastInsertError = null;
                break; // succès
            } catch (e: any) {
                lastInsertError = e;
                if (attempt < 2) {
                    console.warn(`[IngestWorker] Insert échoué (tentative ${attempt + 1}/3), retry dans 400ms...`);
                    await new Promise(r => setTimeout(r, 400));
                }
            }
        }
        if (lastInsertError) throw lastInsertError;

        if (c.env?.DB) {
            await c.env.DB.prepare(`
                UPDATE media_state 
                SET active_links = active_links + ?,
                    has_content = 1,
                    last_scraped = ?,
                    next_scrape = ?
                WHERE media_id = ?
            `).bind(inserted.length, Date.now(), Date.now() + (24 * 3600 * 1000), mediaId).run();
        }

        // Update activeLinksCount in Neon
        try {
            await db.update(medias)
                .set({ activeLinksCount: sql`active_links_count + ${inserted.length}` })
                .where(eq(medias.id, mediaId));
        } catch (e: any) {
            console.warn(`[IngestWorker] Failed to update activeLinksCount in Neon: ${e.message}`);
        }

        // Sync to Turso (non-blocking)
        const tursoUrl = c.env?.TURSO_DATABASE_URL || '';
        const tursoToken = c.env?.TURSO_AUTH_TOKEN || '';
        if (tursoUrl && tursoToken && inserted.length > 0) {
            try {
                const turso = createClient({ url: tursoUrl, authToken: tursoToken });
                const connStr = getVar(c, 'NEON_DATABASE_URL');
                const hyperdrive = c.env?.HYPERDRIVE;
                const neonDb = getNeonDb(connStr, hyperdrive) as any;
                const [mediaRow] = await neonDb.select().from(medias).where(eq(medias.id, mediaId));
                const mediaExists = await turso.execute('SELECT id FROM medias WHERE id = ?', [mediaId]);
                if (mediaRow && mediaExists.rows.length === 0) {
                    await turso.execute({
                        sql: 'INSERT OR REPLACE INTO medias (id, external_id, type, title, original_title, slug, synopsis, year, poster_url, backdrop_url, rating, vote_count, status, tmdb_id, imdb_id, anilist_id, mal_id, kitsu_id, igdb_id, anidb_id, metadata_source, metadata_fresh_at, links_last_scraped_at, active_links_count, created_at, updated_at, author, episode_count, genres, trailer_url, duration, tagline, studios) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                        args: [mediaRow.id, mediaRow.externalId, mediaRow.type, mediaRow.title, mediaRow.originalTitle, mediaRow.slug?.slice(0, 100), mediaRow.synopsis, mediaRow.year, mediaRow.posterUrl, mediaRow.backdropUrl, mediaRow.rating?.toString(), mediaRow.voteCount, mediaRow.status, mediaRow.tmdbId, mediaRow.imdbId, mediaRow.anilistId, mediaRow.malId, mediaRow.kitsuId, mediaRow.igdbId, mediaRow.anidbId, mediaRow.metadataSource, mediaRow.metadataFreshAt?.toISOString() || null, mediaRow.linksLastScrapedAt?.toISOString() || null, mediaRow.activeLinksCount, mediaRow.createdAt?.toISOString() || null, new Date().toISOString(), mediaRow.author, mediaRow.episodeCount, mediaRow.genres, mediaRow.trailerUrl, null, mediaRow.tagline, mediaRow.studios]
                    });
                }
                const BATCH = 50;
                for (let i = 0; i < inserted.length; i += BATCH) {
                    const chunk = inserted.slice(i, i + BATCH);
                    const stmts = chunk.map((l: any) => ({
                        sql: 'INSERT OR REPLACE INTO liens (id, media_id, episode_id, source_site, player_host, url, quality, language, has_subtitles, is_active, fail_count, last_verified, scraped_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                        args: [l.id, l.mediaId, l.episodeId, l.sourceSite, l.playerHost, l.url, l.quality, l.language, l.hasSubtitles ? 1 : 0, true, 0, new Date().toISOString(), new Date().toISOString()]
                    }));
                    await turso.batch(stmts, 'deferred');
                }
                await turso.close();
            } catch (tursoError: any) {
                console.warn(`[IngestWorker] Turso sync failed (non-blocking): ${tursoError.message}`);
            }
        }

        await logger.audit('IngestWorker', `Ingestion réussie: ${inserted.length} liens`, { mediaId, count: inserted.length }, mongoUri(c));
        return c.json({ success: true, count: inserted.length });
    } catch (error: any) {
        // Compensation: si D1 a échoué après Neon, nettoyer les lignes insérées
        if (inserted.length > 0) {
            try {
                const connStr = getVar(c, 'NEON_DATABASE_URL');
                const hyperdrive = c.env?.HYPERDRIVE;
                const db = getNeonDb(connStr, hyperdrive) as any;
                const insertedIds = inserted.map((r: any) => r.id).filter(Boolean);
                if (insertedIds.length > 0) {
                    await db.delete(liens).where(inArray(liens.id, insertedIds));
                    await logger.warn('IngestWorker', 'Rollback effectué après erreur D1', { mediaId, deletedCount: insertedIds.length }, mongoUri(c));
                }
            } catch (rollbackError: any) {
                await logger.error('IngestWorker', `Rollback échoué: ${rollbackError.message}`, { mediaId }, mongoUri(c));
                console.error('Rollback échoué:', rollbackError);
            }
        }
        await logger.error('IngestWorker', `Erreur Ingestion: ${error.message}`, { mediaId }, mongoUri(c));
        console.error('Ingestion Error:', error.message);
        return c.json({ success: false, error: 'Erreur insertion' }, 500);
    }
});

// ========== GET /api/internal/resolve/stale ==========
internalRoutes.get('/resolve/stale', async (c) => {
    const limit = parseInt(c.req.query('limit') || '50');
    try {
        if (!c.env?.DB) {
            return c.json({ success: false, error: 'D1 non disponible' }, 501);
        }
        const stale = await c.env.DB.prepare(`
            SELECT * FROM media_state 
            WHERE next_scrape < ? OR has_content = 0
            ORDER BY scrape_priority ASC, next_scrape ASC
            LIMIT ?
        `).bind(Date.now(), limit).all<MediaState>();

        return c.json({ success: true, data: stale.results });
    } catch (error: any) {
        console.error('Resolve Stale Error:', error.message);
        return c.json({ success: false, error: 'Erreur récupération' }, 500);
    }
});

const TYPE_NORMALIZE: Record<string, string> = {
    'game': 'jeu', 'movie': 'film', 'show': 'serie', 'tv': 'serie',
    'manga': 'comic', 'bande-dessinee': 'comic',
};

const VALID_TYPES = new Set(['anime', 'comic', 'film', 'jeu', 'novel', 'serie', 'webtoon']);

function normalizeType(type: string, id: string): string {
    const normalized = TYPE_NORMALIZE[type] || type;
    if (normalized !== type) {
        console.log(`[TYPE FIX] ${id}: '${type}' -> '${normalized}'`);
    }
    if (!VALID_TYPES.has(normalized)) {
        console.warn(`[TYPE WARN] ${id}: type '${normalized}' inattendu`);
    }
    return normalized;
}

// ========== POST /api/internal/ingest/media ==========
const ingestMediaSchema = z.object({
    id: z.string().uuid(),
    type: z.string(),
    metadata_ok: z.number().default(0),
    active_links: z.number().default(0),
    has_content: z.number().default(0),
    title: z.string().optional(),
    slug: z.string().optional()
});

internalRoutes.post('/ingest/media', zValidator('json', ingestMediaSchema as any), async (c) => {
    let { id, type, metadata_ok, active_links, has_content, title, slug } = c.req.valid('json');
    type = normalizeType(type, id);
    if (type === 'book') return c.json({ success: true, skipped: true });
    try {
        if (!c.env?.DB) return c.json({ success: false, error: 'D1 non disponible' }, 501);
        if (slug) {
            await c.env.DB.prepare(
                `DELETE FROM media_state WHERE slug = ? AND media_id != ?`
            ).bind(slug, id).run();
        }
        await c.env.DB.prepare(`
        INSERT INTO media_state (media_id, type, title, slug, metadata_ok, active_links, has_content, next_scrape, scrape_priority)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(media_id) DO UPDATE SET
            title = COALESCE(excluded.title, title),
            slug = COALESCE(excluded.slug, slug),
            metadata_ok = MAX(metadata_ok, excluded.metadata_ok),
            active_links = excluded.active_links,
            has_content = excluded.has_content
        `).bind(id, type, title || null, slug || null, metadata_ok, active_links, has_content, Date.now() + 10000).run();
        return c.json({ success: true });
    } catch (error: any) {
        console.error('Ingest Media Error:', error.message);
        return c.json({ success: false, error: `Erreur D1: ${error.message}` }, 500);
    }
});

// ========== POST /api/internal/ingest/media/batch ==========
const ingestMediaBatchSchema = z.object({
    items: z.array(z.object({
        id: z.string().uuid(),
        type: z.string(),
        metadata_ok: z.number().default(0),
        active_links: z.number().default(0),
        has_content: z.number().default(0),
        title: z.string().optional(),
        slug: z.string().optional()
    })).max(500)
});

internalRoutes.post('/ingest/media/batch', zValidator('json', ingestMediaBatchSchema as any), async (c) => {
    const { items } = c.req.valid('json') as z.infer<typeof ingestMediaBatchSchema>;
    for (const item of items) {
        item.type = normalizeType(item.type, item.id);
    }
    const nonBooks = items.filter(i => i.type !== 'book');
    if (items.length !== nonBooks.length) {
        console.log(`Batch ingest: ${items.length - nonBooks.length} book(s) skipped`);
    }
    try {
        if (!c.env?.DB) return c.json({ success: false, error: 'D1 non disponible' }, 501);
        const cleanStatements = nonBooks
            .filter(item => item.slug)
            .map(item =>
                c.env.DB!.prepare(
                    `DELETE FROM media_state WHERE slug = ? AND media_id != ?`
                ).bind(item.slug, item.id)
            );
        if (cleanStatements.length > 0) {
            await c.env.DB.batch(cleanStatements);
        }
        const statements = nonBooks.map(item =>
            c.env.DB!.prepare(`
                INSERT INTO media_state (media_id, type, title, slug, metadata_ok, active_links, has_content, next_scrape, scrape_priority)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
                ON CONFLICT(media_id) DO UPDATE SET
                    title = COALESCE(excluded.title, title),
                    slug = COALESCE(excluded.slug, slug),
                    metadata_ok = MAX(metadata_ok, excluded.metadata_ok),
                    active_links = excluded.active_links,
                    has_content = excluded.has_content
            `).bind(item.id, item.type, item.title || null, item.slug || null, item.metadata_ok, item.active_links, item.has_content, Date.now() + 10000)
        );
        if (statements.length > 0) {
            await c.env.DB.batch(statements);
        }
        return c.json({ success: true, count: items.length });
    } catch (error: any) {
        console.error('Ingest Media Batch Error:', error.message);
        return c.json({ success: false, error: `Erreur D1 batch: ${error.message}` }, 500);
    }
});

// ========== POST /api/internal/ingest/media/create ==========
const createMediaSchema = z.object({
  title: z.string().min(1).max(500),
  type: z.string().min(1).max(20),
  slug: z.string().min(1).max(500),
  synopsis: z.string().optional().nullable(),
  year: z.number().int().optional().nullable(),
  posterUrl: z.string().optional().nullable(),
  backdropUrl: z.string().optional().nullable(),
  rating: z.number().optional().nullable(),
  externalId: z.string().optional().nullable(),
  metadataSource: z.string().optional().nullable(),
});

internalRoutes.post('/ingest/media/create', zValidator('json', createMediaSchema as any), async (c) => {
  const input = c.req.valid('json') as z.infer<typeof createMediaSchema>;

  try {
    const connStr = getVar(c, 'NEON_DATABASE_URL');
    const hyperdrive = c.env?.HYPERDRIVE;
    const db = getNeonDb(connStr, hyperdrive) as any;

    const mediaId = crypto.randomUUID();

    await db.insert(medias).values({
      id: mediaId,
      title: input.title,
      type: input.type,
      slug: input.slug,
      synopsis: input.synopsis || null,
      year: input.year || null,
      posterUrl: input.posterUrl || null,
      backdropUrl: input.backdropUrl || null,
      rating: input.rating ? String(input.rating) : null,
      externalId: input.externalId || null,
      metadataSource: input.metadataSource || 'external',
      activeLinksCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Upsert D1 media_state
    if (c.env?.DB) {
      await c.env.DB.prepare(`
        INSERT INTO media_state (media_id, type, title, slug, metadata_ok, active_links, has_content, next_scrape, scrape_priority)
        VALUES (?, ?, ?, ?, 1, 0, 0, ?, 1)
        ON CONFLICT(media_id) DO UPDATE SET
          title = COALESCE(excluded.title, title),
          slug = COALESCE(excluded.slug, slug),
          metadata_ok = 1
      `).bind(mediaId, input.type, input.title, input.slug, Date.now() + 10000).run();
    }

    // Sync to Turso
    const tursoUrl = c.env?.TURSO_DATABASE_URL || '';
    const tursoToken = c.env?.TURSO_AUTH_TOKEN || '';
    if (tursoUrl && tursoToken) {
      try {
        const turso = createClient({ url: tursoUrl, authToken: tursoToken });
        await turso.execute({
          sql: 'INSERT OR REPLACE INTO medias (id, external_id, type, title, slug, synopsis, year, poster_url, backdrop_url, rating, metadata_source, active_links_count, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          args: [mediaId, input.externalId || null, input.type, input.title, input.slug, input.synopsis || null, input.year || null, input.posterUrl || null, input.backdropUrl || null, input.rating?.toString() || null, input.metadataSource || 'external', 0, new Date().toISOString(), new Date().toISOString()]
        });
        await turso.close();
      } catch (tursoError: any) {
        console.warn(`[CreateMedia] Turso sync failed (non-blocking): ${tursoError.message}`);
      }
    }

    await logger.audit('CreateMedia', `Media created: ${input.title}`, { mediaId, type: input.type }, mongoUri(c));
    return c.json({ success: true, mediaId });
  } catch (error: any) {
    await logger.error('CreateMedia', `Erreur creation media: ${error.message}`, { title: input.title }, mongoUri(c));
    console.error('CreateMedia Error:', error.message);
    return c.json({ success: false, error: `Erreur creation: ${error.message}` }, 500);
  }
});

// ========== POST /api/internal/ingest/mapping ==========
const mappingSchema = z.object({
    mappings: z.array(z.object({
        anilist_id: z.union([z.string(), z.number()]),
        tmdb_id: z.union([z.string(), z.number()]).optional().nullable(),
        mal_id: z.union([z.string(), z.number()]).optional().nullable(),
        imdb_id: z.union([z.string(), z.number()]).optional().nullable(),
    })).max(1000)
});

internalRoutes.post('/ingest/mapping', zValidator('json', mappingSchema as any), async (c) => {
    const { mappings } = c.req.valid('json') as z.infer<typeof mappingSchema>;
    try {
        if (!c.env?.DB) return c.json({ success: false, error: 'D1 non disponible' }, 501);
        
        // Validation basique: au moins un ID doit être valide
        const validMappings = mappings.filter(m => m.anilist_id && (m.tmdb_id || m.mal_id || m.imdb_id));
        
        if (validMappings.length === 0) {
            return c.json({ success: false, error: "Aucun mapping valide (anilist_id + au moins un autre ID requis)" }, 400);
        }

        const statements = validMappings.map((m) => {
            // Normaliser tmdb_id : Fribb peut l'envoyer comme { tv: 13916 } ou directement 13916
            let tmdbIdVal = m.tmdb_id;
            if (tmdbIdVal && typeof tmdbIdVal === 'object') {
                tmdbIdVal = (tmdbIdVal as any).tv ?? (tmdbIdVal as any).movie ?? null;
            }
            // Valider que c'est bien un nombre
            const tmdbStr = tmdbIdVal && !isNaN(Number(tmdbIdVal)) ? String(Number(tmdbIdVal)) : null;

            return c.env.DB.prepare(`
                INSERT INTO id_mapping (anilist_id, tmdb_id, mal_id, imdb_id)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(anilist_id) DO UPDATE SET
                    tmdb_id = excluded.tmdb_id,
                    mal_id = excluded.mal_id,
                    imdb_id = excluded.imdb_id
            `).bind(String(m.anilist_id), tmdbStr, m.mal_id ? String(m.mal_id) : null, m.imdb_id ? String(m.imdb_id) : null);
        });
        await c.env.DB.batch(statements);
        
        await logger.info('IngestWorker', `Mapping mis à jour: ${validMappings.length} entrées`, {}, mongoUri(c));
        return c.json({ success: true, count: validMappings.length });
    } catch (e: any) {
        await logger.error('IngestWorker', `Erreur Mapping: ${e.message}`, {}, mongoUri(c));
        console.error("D1 Mapping Ingest Error:", e.message);
        return c.json({ error: e.message }, 500);
    }
});

// ========== GET /api/internal/resolve/tmdb ==========
internalRoutes.get('/resolve/tmdb', async (c) => {
    const anilistId = c.req.query('anilist_id');
    const mediaId = c.req.query('media_id');
    try {
        if (!c.env?.DB) return c.json({ success: false, error: 'D1 non disponible' }, 501);

        let mapping;
        if (anilistId) {
            mapping = await c.env.DB.prepare(`
                SELECT tmdb_id FROM id_mapping WHERE anilist_id = ?
            `).bind(anilistId).first<{ tmdb_id: string | null }>();
        } else if (mediaId) {
            // Fallback: lookup via Neon anilist_id
            const connStr = getVar(c, 'NEON_DATABASE_URL');
            const hyperdrive = c.env?.HYPERDRIVE;
            const db = getNeonDb(connStr, hyperdrive) as any;
            const [media] = await db.select({ anilistId: medias.anilistId })
                .from(medias)
                .where(eq(medias.id, mediaId));
            if (media?.anilistId) {
                mapping = await c.env.DB.prepare(`
                    SELECT tmdb_id FROM id_mapping WHERE anilist_id = ?
                `).bind(String(media.anilistId)).first<{ tmdb_id: string | null }>();
            }
        }

        if (!mapping?.tmdb_id) {
            // Fallback: TMDB search live par titre anime
            const connStr = getVar(c, 'NEON_DATABASE_URL');
            const hyperdrive = c.env?.HYPERDRIVE;
            const db = getNeonDb(connStr, hyperdrive) as any;

            let searchTitle: string | undefined;
            let resolvedAnilist: string | undefined = anilistId;

            if (anilistId) {
                const [media] = await db.select({ title: medias.title, tmdbId: medias.tmdbId })
                    .from(medias)
                    .where(eq(medias.anilistId, parseInt(anilistId)));
                if (media?.tmdbId) {
                    await c.env.DB.prepare(`
                        INSERT INTO id_mapping (anilist_id, tmdb_id) VALUES (?, ?)
                        ON CONFLICT(anilist_id) DO UPDATE SET tmdb_id = excluded.tmdb_id
                    `).bind(anilistId, String(media.tmdbId)).run();
                    return c.json({ success: true, tmdb_id: media.tmdbId });
                }
                searchTitle = media?.title ?? undefined;
            } else if (mediaId) {
                const [media] = await db.select({ title: medias.title, anilistId: medias.anilistId, tmdbId: medias.tmdbId })
                    .from(medias)
                    .where(eq(medias.id, mediaId));
                if (media?.tmdbId && media.anilistId) {
                    await c.env.DB.prepare(`
                        INSERT INTO id_mapping (anilist_id, tmdb_id) VALUES (?, ?)
                        ON CONFLICT(anilist_id) DO UPDATE SET tmdb_id = excluded.tmdb_id
                    `).bind(String(media.anilistId), String(media.tmdbId)).run();
                    return c.json({ success: true, tmdb_id: media.tmdbId });
                }
                searchTitle = media?.title ?? undefined;
                resolvedAnilist = media?.anilistId ? String(media.anilistId) : undefined;
            }

            if (searchTitle && resolvedAnilist) {
                const tmdbKey = getVar(c, 'TMDB_API_KEY');
                if (tmdbKey) {
                    async function tmdbSearch(type: string, lang: string) {
                        const res = await fetch(
                            `https://api.themoviedb.org/3/search/${type}?api_key=${tmdbKey}&query=${encodeURIComponent(searchTitle!)}&language=${lang}`
                        );
                        if (!res.ok) return null;
                        const data = await res.json() as any;
                        return data?.results?.[0]?.id ?? null;
                    }

                    let foundId = await tmdbSearch('tv', 'en-US')
                        ?? await tmdbSearch('tv', 'fr-FR')
                        ?? await tmdbSearch('movie', 'en-US')
                        ?? await tmdbSearch('movie', 'fr-FR');

                    // Fribb fallback: lookup anilist_id in upstream mapping
                    if (!foundId) {
                        try {
                            const fribbRes = await fetch('https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json');
                            if (fribbRes.ok) {
                                const fribbData = await fribbRes.json() as any[];
                                const match = fribbData.find(e => String(e.anilist_id) === resolvedAnilist);
                                if (match?.themoviedb_id) {
                                    foundId = typeof match.themoviedb_id === 'number'
                                        ? match.themoviedb_id
                                        : (match.themoviedb_id.tv ?? match.themoviedb_id.movie ?? null);
                                }
                            }
                        } catch { /* Fribb unreachable, continue */ }
                    }

                    if (foundId) {
                        await c.env.DB.prepare(`
                            INSERT INTO id_mapping (anilist_id, tmdb_id) VALUES (?, ?)
                            ON CONFLICT(anilist_id) DO UPDATE SET tmdb_id = excluded.tmdb_id
                        `).bind(resolvedAnilist, String(foundId)).run();
                        await db.update(medias).set({ tmdbId: foundId })
                            .where(eq(medias.anilistId, parseInt(resolvedAnilist)));
                        return c.json({ success: true, tmdb_id: foundId });
                    }
                }
            }
            return c.json({ success: false, error: 'Mapping non trouvé' }, 404);
        }
        const parsed = parseInt(String(mapping.tmdb_id), 10);
        if (isNaN(parsed)) {
            return c.json({ success: false, error: 'TMDB ID invalide' }, 404);
        }
        return c.json({ success: true, tmdb_id: parsed });
    } catch (error: any) {
        console.error('Resolve TMDB Error:', error.message);
        return c.json({ success: false, error: error.message }, 500);
    }
});

// ========== POST /api/internal/orchestrate ==========
internalRoutes.post('/orchestrate', async (c) => {
    try {
        const orchestrator = new OrchestratorService(c.env);
        const result = await orchestrator.resolveStaleMedia();
        await logger.audit('Orchestrator', 'Trigger manuel via endpoint', result, mongoUri(c));
        return c.json({ success: true, ...result });
    } catch (error: any) {
        await logger.error('Orchestrator', `Erreur trigger manuel: ${error.message}`, {}, mongoUri(c));
        return c.json({ success: false, error: error.message }, 500);
    }
});

// ========== POST /api/internal/cleanup/d1-state ==========
const cleanupSchema = z.object({
    type: z.string().optional(),
    before: z.number().optional(),
    mediaId: z.string().optional(),
});

internalRoutes.post('/cleanup/d1-state', zValidator('json', cleanupSchema as any), async (c) => {
    const { type, before, mediaId } = c.req.valid('json') as z.infer<typeof cleanupSchema>;
    try {
        if (!c.env?.DB) return c.json({ success: false, error: 'D1 non disponible' }, 501);

        let sql = 'DELETE FROM media_state WHERE 1=1';
        const params: any[] = [];

        if (type) {
            sql += ' AND type = ?';
            params.push(type);
        }
        if (before) {
            sql += ' AND next_scrape < ?';
            params.push(before);
        }
        if (mediaId) {
            sql += ' AND media_id = ?';
            params.push(mediaId);
        }

        const result = await c.env.DB.prepare(sql).bind(...params).run();
        const detail = mediaId ? `mediaId=${mediaId}` : (type ? `type=${type}` : 'all');
        console.log(`Cleanup D1: ${result.meta.changes} ligne(s) supprimee(s) (${detail})`);

        return c.json({ success: true, deleted: result.meta.changes, type: type || 'all' });
    } catch (error: any) {
        console.error('Cleanup D1 Error:', error.message);
        return c.json({ success: false, error: error.message }, 500);
    }
});

export default internalRoutes;
