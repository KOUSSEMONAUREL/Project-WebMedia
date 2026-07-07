import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getNeonDb as getNeonDbSingleton, getTursoClient } from '../db/singleton';
import { medias, episodes, liens } from '../db/turso/schema';
import { medias as neonMedias } from '../db/neon/schema';
import { eq, desc, asc, and, sql } from 'drizzle-orm';

type Bindings = {
    HYPERDRIVE: Hyperdrive;
    NEON_DATABASE_URL: string;
    TURSO_DATABASE_URL: string;
    TURSO_AUTH_TOKEN: string;
    INTERNAL_API_KEY: string;
};

const mediaRoutes = new Hono<{ Bindings: Bindings }>();

// Mapping des types francais (API/frontend) vers anglais (DB)
const TYPE_MAP: Record<string, string> = {
  film: 'movie',
  jeu: 'game',
};
const mapType = (t: string) => TYPE_MAP[t] || t;

// Helper universel pour les variables d'env
const getVar = (c: any, key: string) => {
    const val = c.env?.[key] || (process.env as any)[key];
    if (!val && c.env?.ENVIRONMENT === 'production') {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return val;
};

// Helpers typés (singleton — réutilise les connexions)
const getTursoDb = (c: any) => {
    const url = getVar(c, 'TURSO_DATABASE_URL');
    const token = getVar(c, 'TURSO_AUTH_TOKEN');
    return getTursoClient(url, token);
};

const getNeonWriteDb = (c: any) => {
    return getNeonDbSingleton(getVar(c, 'NEON_DATABASE_URL'), c.env?.HYPERDRIVE);
};

// ========== GET /api/media/trending ==========
mediaRoutes.get('/trending', async (c) => {
    try {
        const db = getTursoDb(c);
        const trending = await db.select()
            .from(medias)
            .orderBy(desc(medias.rating), desc(medias.createdAt))
            .limit(20);
        c.header('Cache-Control', 'public, max-age=60');
        return c.json({ success: true, data: trending, count: trending.length, source: 'turso' });
    } catch (error: any) {
        console.error('Erreur trending:', error.message);
        return c.json({ success: false, error: 'Erreur lors de la récupération des tendances' }, 500);
    }
});

// ========== GET /api/media (Listing par type) ==========
const listMediaSchema = z.object({
    type: z.enum(['film', 'serie', 'anime', 'jeu', 'webtoon', 'book', 'novel']),
    sort: z.enum(['created_at', 'title', 'rating', 'year']).optional().default('created_at'),
    order: z.enum(['asc', 'desc']).optional().default('desc'),
    limit: z.coerce.number().int().min(1).max(200).optional().default(20),
    offset: z.coerce.number().int().min(0).optional().default(0),
});

const SORT_COLUMNS: Record<string, any> = {
    created_at: medias.createdAt,
    title: medias.title,
    rating: medias.rating,
    year: medias.year,
};

mediaRoutes.get('/', zValidator('query', listMediaSchema as any), async (c) => {
    const { type, sort, order, limit, offset } = c.req.valid('query' as any);
    try {
        const db = getTursoDb(c);
        const mediaType = mapType(type);
        const orderFn = order === 'asc' ? asc : desc;
        const orderByColumn = orderFn(SORT_COLUMNS[sort]);

        const [{ total }] = await db.select({ total: sql<number>`count(*)` })
            .from(medias)
            .where(eq(medias.type, mediaType));
        const results = await db.select()
            .from(medias)
            .where(eq(medias.type, mediaType))
            .orderBy(orderByColumn)
            .limit(limit)
            .offset(offset);
        c.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
        return c.json({ success: true, data: results, total, limit, offset, sort, order, source: 'turso' });
    } catch (error: any) {
        console.error(`Erreur listing ${type}:`, error.message);
        return c.json({ success: false, error: 'Erreur lors du chargement des médias' }, 500);
    }
});

// ========== GET /api/media/:type/:slug ==========
mediaRoutes.get('/:type/:slug', async (c) => {
    const { type, slug } = c.req.param();
    try {
        const db = getTursoDb(c);
        const result = await db.select()
            .from(medias)
            .where(and(eq(medias.type, mapType(type)), eq(medias.slug, slug)))
            .limit(1);
        if (result.length === 0) {
            return c.json({ success: false, error: 'Média non trouvé' }, 404);
        }
        const media = result[0];
        const hasEpisodes = type === 'serie' || type === 'anime';
        const [mediaEpisodes, mediaLiens] = await Promise.all([
            hasEpisodes
                ? db.select()
                    .from(episodes)
                    .where(eq(episodes.mediaId, media.id))
                    .orderBy(episodes.seasonNumber, episodes.episodeNumber)
                : Promise.resolve([] as (typeof episodes.$inferSelect)[]),
            db.select()
                .from(liens)
                .where(eq(liens.mediaId, media.id))
        ]);
        c.header('Cache-Control', 'public, max-age=60');
        return c.json({
            success: true,
            data: { ...media, episodes: mediaEpisodes, links: mediaLiens },
            source: 'turso'
        });
    } catch (error: any) {
        console.error('Erreur récupération média:', error.message);
        return c.json({ success: false, error: 'Erreur serveur' }, 500);
    }
});

// ========== POST /api/media ==========
const createMediaSchema = z.object({
    title: z.string().min(1).max(500),
    type: z.enum(['film', 'serie', 'anime', 'jeu', 'webtoon', 'book', 'novel']),
    year: z.number().int().min(1900).max(2100),
    synopsis: z.string().optional(),
    posterUrl: z.string().url().optional(),
    rating: z.number().min(0).max(10).optional(),
    tmdbId: z.number().optional(),
});

mediaRoutes.post('/', async (c, next) => {
    // Sécurité: Seuls les scrapers internes peuvent créer des médias
    const apiKey = c.req.header('X-Internal-API-Key');
    const secretKey = getVar(c, 'INTERNAL_API_KEY');
    if (!apiKey || apiKey !== secretKey) {
        return c.json({ error: 'Unauthorized (Internal API Key required)' }, 401);
    }
    return next();
}, zValidator('json', createMediaSchema as any), async (c) => {
    const data = c.req.valid('json' as any);
    try {
        const db = getNeonWriteDb(c);
        // Génération de slug robuste
        const baseSlug = data.title
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Remove accents
            .trim()
            .replace(/\s+/g, '-')
            .replace(/[^\w-]+/g, '')
            .replace(/--+/g, '-');
        
        // Ajout de l'année au slug pour éviter les collisions (remakes etc)
        const slug = `${baseSlug}-${data.year || new Date().getFullYear()}`.slice(0, 100);

        const result = await db.insert(neonMedias).values({
            ...data,
            slug,
            rating: data.rating?.toString() || "0"
        } as any).returning();

        return c.json({
            success: true,
            message: 'Média créé avec succès',
            data: result[0],
            source: 'neon'
        }, 201);
    } catch (error: any) {
        console.error('Erreur création média:', error.message);
        return c.json({ success: false, error: 'Erreur lors de la création du média' }, 500);
    }
});

export default mediaRoutes;
