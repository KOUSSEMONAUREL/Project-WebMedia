import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getNeonDb } from '../db/singleton';
import { medias, episodes, liens } from '../db/neon/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { MediaState } from '../services/resolver';
import { logger } from '../services/logger';
import { OrchestratorService } from '../services/orchestrator';

type Bindings = {
    NEON_DATABASE_URL: string;
    HYPERDRIVE: Hyperdrive;
    INTERNAL_API_KEY: string;
    MONGODB_URI: string;
    DB: D1Database;
};

const internalRoutes = new Hono<{ Bindings: Bindings }>();

// Helper universel pour les variables d'env
const getVar = (c: any, key: string) => c.env?.[key] || (process.env as any)[key];

// Middleware de sécurité
internalRoutes.use('*', async (c, next) => {
    const apiKey = c.req.header('X-Internal-API-Key');
    const secretKey = getVar(c, 'INTERNAL_API_KEY');
    if (!apiKey || apiKey !== secretKey) {
        return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
});

const ALLOWED_PLAYERS = [
    'vidsrc.me', 'voe.sx', 'streamwish.to', 'doodstream.com', 'filemoon.sx', 'upstream.to',
    'royalroad.com', 'wuxiaworld.com', 'lightnovelpub.com', 'boxnovel.com', 'novel-bin.com'
];

// ========== POST /api/internal/ingest/liens ==========
const ingestLiensSchema = z.object({
    mediaId: z.string().uuid(),
    episodeId: z.string().uuid().optional(),
    links: z.array(z.object({
        source_site: z.string(),
        player_host: z.string(),
        url: z.string().url(),
        qualite: z.string().optional(),
        langue: z.string().optional(),
        sous_titres: z.boolean().optional().default(false),
        headers: z.record(z.string()).optional()
    }))
});

internalRoutes.post('/ingest/liens', zValidator('json', ingestLiensSchema as any), async (c) => {
    const data = c.req.valid('json') as z.infer<typeof ingestLiensSchema>;
    const { mediaId, episodeId, links } = data;

    // Filter links: All links MUST match whitelist, except Novels don't need player check IF they match source whitelist
    const safeLinks = links.filter(l => {
        const isWhitelistedPlayer = ALLOWED_PLAYERS.some(player => 
            l.url.includes(player) || (l.player_host && l.player_host.includes(player))
        );
        
        // Novel specifics: We still want them from a whitelisted host (royalroad etc)
        return isWhitelistedPlayer;
    });

    if (safeLinks.length === 0) {
        await logger.warn('IngestWorker', 'Tentative d\'ingestion sans liens valides', { mediaId, links }, getVar(c, 'MONGODB_URI'));
        return c.json({ success: true, count: 0, message: "Aucun lien autorisé." });
    }

    let inserted: any[] = [];
    try {
        const connStr = getVar(c, 'NEON_DATABASE_URL');
        const hyperdrive = c.env?.HYPERDRIVE;
        const db = getNeonDb(connStr, hyperdrive) as any;
        inserted = await db.insert(liens).values(
            safeLinks.map(link => ({
                sourceSite: link.source_site,
                playerHost: link.player_host,
                url: link.url,
                quality: link.qualite,
                language: link.langue,
                hasSubtitles: link.sous_titres,
                headers: link.headers,
                mediaId,
                episodeId,
                scrapedAt: new Date()
            }))
        ).returning();

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

        await logger.audit('IngestWorker', `Ingestion réussie: ${inserted.length} liens`, { mediaId, count: inserted.length }, getVar(c, 'MONGODB_URI'));
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
                }
            } catch (rollbackError) {
                console.error('Rollback échoué:', rollbackError);
            }
        }
        await logger.error('IngestWorker', `Erreur Ingestion: ${error.message}`, { mediaId }, getVar(c, 'MONGODB_URI'));
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

// ========== POST /api/internal/ingest/media ==========
const ingestMediaSchema = z.object({
    id: z.string().uuid(),
    type: z.string(),
    metadata_ok: z.number().default(0),
    active_links: z.number().default(0),
    has_content: z.number().default(0)
});

internalRoutes.post('/ingest/media', zValidator('json', ingestMediaSchema as any), async (c) => {
    const { id, type, metadata_ok, active_links, has_content } = c.req.valid('json');
    try {
        if (!c.env?.DB) return c.json({ success: false, error: 'D1 non disponible' }, 501);
        await c.env.DB.prepare(`
            INSERT INTO media_state (media_id, type, metadata_ok, active_links, has_content, next_scrape)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(media_id) DO UPDATE SET
                active_links = excluded.active_links,
                has_content = excluded.has_content
        `).bind(id, type, metadata_ok, active_links, has_content, Date.now()).run();
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
        has_content: z.number().default(0)
    })).max(500)
});

internalRoutes.post('/ingest/media/batch', zValidator('json', ingestMediaBatchSchema as any), async (c) => {
    const { items } = c.req.valid('json') as z.infer<typeof ingestMediaBatchSchema>;
    try {
        if (!c.env?.DB) return c.json({ success: false, error: 'D1 non disponible' }, 501);
        const statements = items.map(item =>
            c.env.DB!.prepare(`
                INSERT INTO media_state (media_id, type, metadata_ok, active_links, has_content, next_scrape)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(media_id) DO UPDATE SET
                    active_links = excluded.active_links,
                    has_content = excluded.has_content
            `).bind(item.id, item.type, item.metadata_ok, item.active_links, item.has_content, Date.now())
        );
        await c.env.DB.batch(statements);
        return c.json({ success: true, count: items.length });
    } catch (error: any) {
        console.error('Ingest Media Batch Error:', error.message);
        return c.json({ success: false, error: `Erreur D1 batch: ${error.message}` }, 500);
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

        const statements = validMappings.map((m) =>
            c.env.DB.prepare(`
                INSERT INTO id_mapping (anilist_id, tmdb_id, mal_id, imdb_id)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(anilist_id) DO UPDATE SET
                    tmdb_id = excluded.tmdb_id,
                    mal_id = excluded.mal_id,
                    imdb_id = excluded.imdb_id
            `).bind(String(m.anilist_id), m.tmdb_id ? String(m.tmdb_id) : null, m.mal_id ? String(m.mal_id) : null, m.imdb_id ? String(m.imdb_id) : null)
        );
        await c.env.DB.batch(statements);
        
        await logger.info('IngestWorker', `Mapping mis à jour: ${validMappings.length} entrées`, {}, getVar(c, 'MONGODB_URI'));
        return c.json({ success: true, count: validMappings.length });
    } catch (e: any) {
        await logger.error('IngestWorker', `Erreur Mapping: ${e.message}`, {}, getVar(c, 'MONGODB_URI'));
        console.error("D1 Mapping Ingest Error:", e.message);
        return c.json({ error: e.message }, 500);
    }
});

// ========== POST /api/internal/orchestrate ==========
internalRoutes.post('/orchestrate', async (c) => {
    try {
        const orchestrator = new OrchestratorService(c.env);
        const result = await orchestrator.resolveStaleMedia();
        await logger.audit('Orchestrator', 'Trigger manuel via endpoint', result, getVar(c, 'MONGODB_URI'));
        return c.json({ success: true, ...result });
    } catch (error: any) {
        await logger.error('Orchestrator', `Erreur trigger manuel: ${error.message}`, {}, getVar(c, 'MONGODB_URI'));
        const allProps: Record<string, any> = {};
        let proto = error;
        while (proto) {
            for (const key of Object.getOwnPropertyNames(proto)) {
                if (key === 'stack') continue;
                allProps[key] = proto[key];
            }
            proto = Object.getPrototypeOf(proto);
            if (proto === Object.prototype) break;
        }
        allProps.message = error.message;
        allProps.stack = error.stack?.split('\n').slice(0, 4).join('\n');
        if (error.cause) allProps.cause = String(error.cause);
        return c.json({ success: false, ...allProps }, 500);
    }
});

export default internalRoutes;
