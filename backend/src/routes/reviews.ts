import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getSupabaseClient } from '../db/singleton';
import { reviews, user } from '../db/supabase/schema';
import { eq, desc, and } from 'drizzle-orm';
import { turnstileMiddleware } from '../middleware/turnstile';

type Bindings = {
    SUPABASE_DATABASE_URL: string;
};

type Variables = {
    user: {
        id: string;
        name: string;
        email: string;
        emailVerified: boolean;
        image?: string | null;
        username?: string | null;
    } | null;
    session: {
        id: string;
        userId: string;
        token: string;
        expiresAt: Date;
    } | null;
};

const reviewRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const getVar = (c: any, key: string) => {
    const val = c.env?.[key] || (process.env as any)[key];
    if (!val && c.env?.ENVIRONMENT === 'production') {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return val;
};

// ========== GET /api/reviews/:mediaId (PUBLIC) ==========
reviewRoutes.get('/:mediaId', async (c) => {
    const mediaId = c.req.param('mediaId');
    const limit = Math.min(Math.abs(Number(c.req.query('limit')) || 50), 100);
    const offset = Math.max(Number(c.req.query('offset')) || 0, 0);
    try {
        const dbUrl = getVar(c, 'SUPABASE_DATABASE_URL');
        const db = getSupabaseClient(dbUrl);

        const mediaReviews = await db.select({
            id: reviews.id,
            userId: reviews.userId,
            mediaId: reviews.mediaId,
            rating: reviews.rating,
            comment: reviews.comment,
            spoiler: reviews.spoiler,
            likes: reviews.likes,
            createdAt: reviews.createdAt,
            updatedAt: reviews.updatedAt,
            userName: user.name,
            userImage: user.image,
        })
            .from(reviews)
            .leftJoin(user, eq(reviews.userId, user.id))
            .where(eq(reviews.mediaId, mediaId))
            .orderBy(desc(reviews.createdAt))
            .limit(limit)
            .offset(offset);

        const data = mediaReviews.map((r: Record<string, any>) => ({
            id: r.id,
            userId: r.userId,
            mediaId: r.mediaId,
            rating: r.rating,
            comment: r.comment,
            spoiler: r.spoiler,
            likes: r.likes,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            user: {
                name: r.userName,
                image: r.userImage,
            },
        }));

        return c.json({ success: true, data, limit, offset });
    } catch (error: any) {
        console.error('Erreur reviews:', { message: error?.message, cause: error?.cause, stack: error?.stack });
        return c.json({ success: false, error: 'Erreur serveur' }, 500);
    }
});

// ========== POST /api/reviews (PROTÉGÉ) ==========
const createReviewSchema = z.object({
    mediaId: z.string().min(1),
    rating: z.number().int().min(1).max(10),
    comment: z.string().max(2000).optional(),
    spoiler: z.boolean().optional().default(false),
});

reviewRoutes.post(
    '/',
    turnstileMiddleware,
    async (c, next) => {
        const sessionUser = c.get('user');
        if (!sessionUser) {
            return c.json({ success: false, error: 'Non authentifié' }, 401);
        }
        await next();
    },
    zValidator('json', createReviewSchema as any),
    async (c) => {
        const data = c.req.valid('json' as any);
        const sessionUser = c.get('user')!;
        const userId = sessionUser.id;

        try {
            const dbUrl = getVar(c, 'SUPABASE_DATABASE_URL');
            const db = getSupabaseClient(dbUrl);

            const existing = await db.select()
                .from(reviews)
                .where(and(eq(reviews.mediaId, data.mediaId), eq(reviews.userId, userId)))
                .limit(1);

            if (existing.length > 0) {
                return c.json({ success: false, error: 'Vous avez déjà posté une review pour ce média' }, 400);
            }

            const result = await db.insert(reviews).values({
                ...data,
                userId
            }).returning();

            return c.json({
                success: true,
                data: result[0]
            }, 201);
        } catch (error: any) {
            console.error('Erreur création review:', { message: error?.message, cause: error?.cause, stack: error?.stack });
            return c.json({ success: false, error: 'Erreur lors de la création de la review' }, 500);
        }
    }
);

export default reviewRoutes;
