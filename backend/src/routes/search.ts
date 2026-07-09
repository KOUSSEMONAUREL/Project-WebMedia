import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getTursoClient } from '../db/singleton';
import { medias } from '../db/turso/schema';
import { and, eq, gt, like, or, sql } from 'drizzle-orm';

type Bindings = {
    TURSO_DATABASE_URL: string;
    TURSO_AUTH_TOKEN: string;
};

const searchRoutes = new Hono<{ Bindings: Bindings }>();

const TYPE_MAP: Record<string, string> = {
  film: 'movie',
  jeu: 'game',
};
const mapType = (t: string) => TYPE_MAP[t] || t;

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

const searchSchema = z.object({
    q: z.string().min(1).max(200),
    type: z.enum(['film', 'serie', 'anime', 'jeu', 'webtoon', 'book', 'novel', 'all']).optional(),
    year: z.coerce.number().int().min(1900).max(2100).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    offset: z.coerce.number().int().min(0).max(1000).optional().default(0),
});

// ========== GET /api/search ==========
searchRoutes.get(
    '/',
    zValidator('query', searchSchema as any),
    async (c) => {
        const { q, type, year, limit, offset } = c.req.valid('query' as any);

        try {
            c.header('Cache-Control', 'public, max-age=60');
            const db = getTursoDb(c);

            const hasActiveLiens = sql`EXISTS (SELECT 1 FROM liens WHERE liens.media_id = medias.id AND liens.is_active = 1)`;
            let searchFilters: any[] = [
                hasActiveLiens,
                or(
                    like(medias.title, `%${q}%`),
                    like(medias.originalTitle, `%${q}%`)
                )
            ];

            if (type && type !== 'all') {
                searchFilters.push(eq(medias.type, mapType(type as string)));
            }

            if (year) {
                searchFilters.push(eq(medias.year, year));
            }

            const results = await db.select({
                    id: medias.id,
                    title: medias.title,
                    slug: medias.slug,
                    type: medias.type,
                    posterUrl: medias.posterUrl,
                    year: medias.year,
                    rating: medias.rating,
                })
                .from(medias)
                .where(and(...searchFilters))
                .limit(limit)
                .offset(offset);

            return c.json({
                success: true,
                query: q,
                data: results,
                limit,
                offset
            });
        } catch (error: any) {
            console.error('Erreur recherche:', error.message);
            return c.json({
                success: false,
                error: 'Erreur lors de la recherche'
            }, 500);
        }
    }
);

export default searchRoutes;
