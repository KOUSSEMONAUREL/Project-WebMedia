import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getNeonDb as getNeonDbSingleton, getTursoClient } from '../db/singleton';
import { medias, episodes, liens } from '../db/turso/schema';
import { medias as neonMedias } from '../db/neon/schema';
import { eq, desc, asc, and, or, like, gte, lte, sql, ne } from 'drizzle-orm';

type Bindings = {
    HYPERDRIVE: Hyperdrive;
    NEON_DATABASE_URL: string;
    TURSO_DATABASE_URL: string;
    TURSO_AUTH_TOKEN: string;
    INTERNAL_API_KEY: string;
};

const mediaRoutes = new Hono<{ Bindings: Bindings }>();

const mapType = (t: string) => t;

const getVar = (c: any, key: string) => {
    const val = c.env?.[key] || (process.env as any)[key];
    if (!val && c.env?.ENVIRONMENT === 'production') {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return val;
};

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
        const typeGroups: { type: string; limit: number }[] = [
            { type: 'movie', limit: 4 },
            { type: 'serie', limit: 4 },
            { type: 'anime', limit: 3 },
            { type: 'jeu', limit: 3 },
            { type: 'webtoon', limit: 2 },
            { type: 'comic', limit: 2 },
            { type: 'book', limit: 2 },
            { type: 'novel', limit: 1 },
        ];
        const results = await Promise.all(
            typeGroups.map(({ type, limit }) =>
                db.select()
                    .from(medias)
                    .where(eq(medias.type, type))
                    .orderBy(desc(medias.rating), desc(medias.createdAt))
                    .limit(limit)
            )
        );
        const trending = results.flat();
        c.header('Cache-Control', 'public, max-age=60');
        return c.json({ success: true, data: trending, count: trending.length, source: 'turso' });
    } catch (error: any) {
        console.error('Erreur trending:', error.message);
        return c.json({ success: false, error: 'Erreur lors de la recuperation des tendances' }, 500);
    }
});

// ========== GET /api/media/all (Admin: tous les medias sans filtre liens) ==========
mediaRoutes.get('/all', async (c) => {
    try {
        const db = getTursoDb(c);
        const results = await db.select()
            .from(medias)
            .orderBy(desc(medias.rating), desc(medias.createdAt))
            .limit(200);
        return c.json({ success: true, data: results, source: 'turso' });
    } catch (error: any) {
        console.error('Erreur all media:', error.message);
        return c.json({ success: false, error: 'Erreur lors de la récupération des médias' }, 500);
    }
});

// ========== GET /api/media (Listing par type + filtres) ==========
const listMediaSchema = z.object({
    type: z.enum(['film', 'serie', 'anime', 'jeu', 'webtoon', 'comic', 'book', 'novel']),
    sort: z.enum(['created_at', 'title', 'rating', 'year']).optional().default('created_at'),
    order: z.enum(['asc', 'desc']).optional().default('desc'),
    limit: z.coerce.number().int().min(1).max(200).optional().default(20),
    offset: z.coerce.number().int().min(0).optional().default(0),
    genre: z.string().optional(),
    yearMin: z.coerce.number().int().min(1900).max(2100).optional(),
    yearMax: z.coerce.number().int().min(1900).max(2100).optional(),
    ratingMin: z.coerce.number().min(0).max(10).optional(),
});

const SORT_COLUMNS: Record<string, any> = {
    created_at: medias.createdAt,
    title: medias.title,
    rating: medias.rating,
    year: medias.year,
};

mediaRoutes.get('/', zValidator('query', listMediaSchema as any), async (c) => {
    const { type, sort, order, limit, offset, genre, yearMin, yearMax, ratingMin } = c.req.valid('query' as any);
    try {
        const db = getTursoDb(c);
        const mediaType = mapType(type);
        const orderFn = order === 'asc' ? asc : desc;
        const orderByColumn = orderFn(SORT_COLUMNS[sort]);

        const conditions: any[] = [eq(medias.type, mediaType)];
        if (genre) {
          const terms = genre.split(',').map((g: string) => g.trim()).filter(Boolean);
          if (terms.length === 1) {
            conditions.push(like(medias.genres, `%${terms[0]}%`));
          } else if (terms.length > 1) {
            conditions.push(or(...terms.map((g: string) => like(medias.genres, `%${g}%`))));
          }
        }
        if (yearMin) conditions.push(gte(medias.year, yearMin));
        if (yearMax) conditions.push(lte(medias.year, yearMax));
        if (ratingMin) conditions.push(gte(sql`cast(${medias.rating} as real)`, ratingMin));
        const where = and(...conditions);

        const [{ total }] = await db.select({ total: sql<number>`count(*)` })
            .from(medias)
            .where(where);
        const results = await db.select()
            .from(medias)
            .where(where)
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

const GENRE_MAP: Record<string, string[]> = {
  action: ['Action', 'Action & Adventure'],
  aventure: ['Aventure', 'Adventure'],
  comedie: ['Comédie', 'Comedy'],
  drame: ['Drame', 'Drama'],
  fantastique: ['Fantastique', 'Fantasy'],
  horreur: ['Horreur', 'Horror'],
  mystere: ['Mystère', 'Mystery'],
  romance: ['Romance'],
  'science-fiction': ['Science-Fiction', 'Sci-Fi'],
  thriller: ['Thriller'],
  animation: ['Animation'],
  documentaire: ['Documentaire'],
  crime: ['Crime'],
  famille: ['Familial', 'Family', 'Famille'],
  western: ['Western'],
  rpg: ['RPG'],
  'arts-martiaux': ['Arts Martiaux'],
};

// ========== GET /api/media/genre-counts ==========
mediaRoutes.get('/genre-counts', async (c) => {
  try {
    const db = getTursoDb(c);
    const rows = await db.select({ type: medias.type, genres: medias.genres })
      .from(medias)
      .where(sql`${medias.genres} IS NOT NULL`);

    const counts: Record<string, Record<string, number>> = {};
    for (const slug of Object.keys(GENRE_MAP)) {
      counts[slug] = { total: 0 };
    }

    for (const row of rows) {
      if (!row.genres) continue;
      let genreList: string[];
      try { genreList = JSON.parse(row.genres); }
      catch { continue; }
      if (!Array.isArray(genreList)) continue;

      for (const [slug, variants] of Object.entries(GENRE_MAP)) {
        if (genreList.some(g => variants.some(v => g.toLowerCase() === v.toLowerCase()))) {
          counts[slug].total++;
        }
      }
    }

    c.header('Cache-Control', 'public, max-age=300');
    return c.json({ success: true, data: counts });
  } catch (error: any) {
    console.error('Erreur genre-counts:', error.message);
    return c.json({ success: false, data: {} });
  }
});

// ========== GET /api/media/:type/:slug/similar ==========
mediaRoutes.get('/:type/:slug/similar', async (c) => {
    const { type, slug } = c.req.param();
    try {
        const db = getTursoDb(c);
        const mediaType = mapType(type);
        let [current] = await db.select()
            .from(medias)
            .where(and(eq(medias.type, mediaType), eq(medias.slug, slug)))
            .limit(1);
        if (!current) {
            const normalized = normalizeSlug(slug);
            if (normalized !== slug) {
                [current] = await db.select()
                    .from(medias)
                    .where(and(eq(medias.type, mediaType), eq(medias.slug, normalized)))
                    .limit(1);
            }
            if (!current && !slug.endsWith('-')) {
                [current] = await db.select()
                    .from(medias)
                    .where(and(eq(medias.type, mediaType), eq(medias.slug, slug + '-')))
                    .limit(1);
            }
            if (!current) return c.json({ success: false, error: 'Média non trouvé' }, 404);
        }

        const genreList: string[] = (() => {
            try { return JSON.parse(current.genres || '[]'); }
            catch { return (current.genres || '').split(',').map((g: string) => g.trim().replace(/^\["|"\]/g, '').replace(/^"|"$/g, '')).filter(Boolean); }
        })();

        let results: typeof medias.$inferSelect[] = [];
        if (genreList.length > 0) {
            const genreConditions = genreList.map((g: string) => like(medias.genres, `%${g}%`));
            results = await db.select()
                .from(medias)
                .where(and(
                    eq(medias.type, mediaType),
                    ne(medias.id, current.id),
                    or(...genreConditions),
                ))
                .orderBy(desc(medias.rating), desc(medias.createdAt))
                .limit(6);
        }

        if (results.length < 6) {
            const existingIds = [current.id, ...results.map(r => r.id)];
            const fallback = await db.select()
                .from(medias)
                .where(and(
                    eq(medias.type, mediaType),
                    ...existingIds.map((id: string) => ne(medias.id, id)),
                ))
                .orderBy(desc(medias.rating), desc(medias.createdAt))
                .limit(6 - results.length);
            results = [...results, ...fallback];
        }

        c.header('Cache-Control', 'public, max-age=300');
        return c.json({ success: true, data: results, source: 'turso' });
    } catch (error: any) {
        console.error('Erreur similaires:', error.message);
        return c.json({ success: false, error: 'Erreur lors de la récupération des médias similaires' }, 500);
    }
});

function normalizeSlug(s: string): string {
    return s.slice(0, 100).replace(/-+$/, '');
}

// ========== GET /api/media/:type/:slug ==========
mediaRoutes.get('/:type/:slug', async (c) => {
    const { type, slug } = c.req.param();
    try {
        const db = getTursoDb(c);
        const mediaType = mapType(type);
        let result = await db.select()
            .from(medias)
            .where(and(eq(medias.type, mediaType), eq(medias.slug, slug)))
            .limit(1);
        if (result.length === 0) {
            const normalized = normalizeSlug(slug);
            if (normalized !== slug) {
                result = await db.select()
                    .from(medias)
                    .where(and(eq(medias.type, mediaType), eq(medias.slug, normalized)))
                    .limit(1);
            }
            if (result.length === 0 && !slug.endsWith('-')) {
                result = await db.select()
                    .from(medias)
                    .where(and(eq(medias.type, mediaType), eq(medias.slug, slug + '-')))
                    .limit(1);
            }
            if (result.length === 0) {
                const numericId = parseInt(slug, 10);
                if (!isNaN(numericId)) {
                    result = await db.select()
                        .from(medias)
                        .where(and(eq(medias.type, mediaType), eq(medias.tmdbId, numericId)))
                        .limit(1);
                }
            }
            if (result.length === 0) {
                return c.json({ success: false, error: 'Média non trouvé' }, 404);
            }
        }
        const media = result[0];
        const hasEpisodes = type === 'serie' || type === 'anime';
        const [mediaEpisodes, mediaLiens, similar] = await Promise.all([
            hasEpisodes
                ? db.select()
                    .from(episodes)
                    .where(eq(episodes.mediaId, media.id))
                    .orderBy(episodes.seasonNumber, episodes.episodeNumber)
                : Promise.resolve([] as (typeof episodes.$inferSelect)[]),
            db.select()
                .from(liens)
                .where(eq(liens.mediaId, media.id)),
            db.select()
                .from(medias)
                .where(and(
                    eq(medias.type, media.type),
                    ne(medias.id, media.id),
                ))
                .orderBy(desc(medias.rating), desc(medias.createdAt))
                .limit(6),
        ]);
        c.header('Cache-Control', 'public, max-age=60');
        return c.json({
            success: true,
            data: { ...media, episodes: mediaEpisodes, links: mediaLiens, similar },
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
    type: z.enum(['film', 'serie', 'anime', 'jeu', 'webtoon', 'comic', 'book', 'novel']),
    year: z.number().int().min(1900).max(2100),
    synopsis: z.string().optional(),
    posterUrl: z.string().url().optional(),
    rating: z.number().min(0).max(10).optional(),
    tmdbId: z.number().optional(),
});

mediaRoutes.post('/', async (c, next) => {
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
        const baseSlug = data.title
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .trim()
            .replace(/\s+/g, '-')
            .replace(/[^\w-]+/g, '')
            .replace(/--+/g, '-');
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
