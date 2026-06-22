import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getSupabaseClient } from '../db/singleton';
import { reviews } from '../db/supabase/schema';
import { eq, desc } from 'drizzle-orm';
import { jwt } from 'hono/jwt';

type Bindings = {
    SUPABASE_DATABASE_URL: string;
    JWT_SECRET: string;
};

type Variables = {
    jwtPayload: {
        id: string;
        email: string;
    };
};

const reviewRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Helper universel pour les variables d'env
const getVar = (c: any, key: string) => c.env?.[key] || (process.env as any)[key];

// ========== GET /api/reviews/:mediaId ==========
reviewRoutes.get('/:mediaId', async (c) => {
    const mediaId = c.req.param('mediaId');
    const dbUrl = getVar(c, 'SUPABASE_DATABASE_URL');
    try {
        const db = getSupabaseClient(dbUrl);

        const mediaReviews = await db.select()
            .from(reviews)
            .where(eq(reviews.mediaId, mediaId))
            .orderBy(desc(reviews.createdAt));

        return c.json({
            success: true,
            data: mediaReviews
        });
    } catch (error: any) {
        console.error('Erreur reviews:', error.message);
        return c.json({ success: false, error: 'Erreur serveur' }, 500);
    }
});

// Middleware JWT
reviewRoutes.use('*', (c, next) => {
    const jwtMiddleware = jwt({
        secret: getVar(c, 'JWT_SECRET'),
        alg: 'HS256'
    });
    return jwtMiddleware(c, next);
});

// ========== POST /api/reviews ==========
const createReviewSchema = z.object({
    mediaId: z.string().min(1),
    rating: z.number().int().min(1).max(10),
    comment: z.string().optional(),
    spoiler: z.boolean().optional().default(false),
});

reviewRoutes.post(
    '/',
    zValidator('json', createReviewSchema as any),
    async (c) => {
        const data = c.req.valid('json' as any);
        const userId = c.get('jwtPayload').id;
        const dbUrl = getVar(c, 'SUPABASE_DATABASE_URL');

        try {
            const db = getSupabaseClient(dbUrl);

            const result = await db.insert(reviews).values({
                ...data,
                userId
            }).returning();

            return c.json({
                success: true,
                data: result[0]
            }, 201);
        } catch (error: any) {
            console.error('Erreur création review:', error.message);
            return c.json({ success: false, error: 'Erreur lors de la création de la review' }, 500);
        }
    }
);

export default reviewRoutes;
