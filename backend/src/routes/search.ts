import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { createDbClient } from '../db/client';
import { medias } from '../db/neon/schema';
import { ilike, and, eq, or } from 'drizzle-orm';

type Bindings = {
    NEON_DATABASE_URL: string;
};

const searchRoutes = new Hono<{ Bindings: Bindings }>();

// Helper universel pour les variables d'env
const getVar = (c: any, key: string) => c.env?.[key] || (process.env as any)[key];

const searchSchema = z.object({
    q: z.string().min(1).max(200),
    type: z.enum(['film', 'serie', 'anime', 'jeu', 'webtoon', 'all']).optional(),
    year: z.coerce.number().int().min(1900).max(2100).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    offset: z.coerce.number().int().min(0).optional().default(0),
});

// ========== GET /api/search ==========
searchRoutes.get(
    '/',
    zValidator('query', searchSchema as any),
    async (c) => {
        const { q, type, year, limit, offset } = c.req.valid('query' as any);
        const dbUrl = getVar(c, 'NEON_DATABASE_URL');

        try {
            const db = createDbClient(dbUrl, 'neon');

            let searchFilters = [
                or(
                    ilike(medias.title, `%${q}%`),
                    ilike(medias.originalTitle, `%${q}%`)
                )
            ];

            if (type && type !== 'all') {
                searchFilters.push(eq(medias.type, type as any));
            }

            if (year) {
                searchFilters.push(eq(medias.year, year));
            }

            const results = await db.select()
                .from(medias)
                .where(and(...searchFilters))
                .limit(limit)
                .offset(offset);

            return c.json({
                success: true,
                query: q,
                count: results.length,
                data: results
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
