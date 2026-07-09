import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getSupabaseHttpClient } from '../db/singleton';
import { turnstileMiddleware } from '../middleware/turnstile';

type Bindings = {
    SUPABASE_URL: string;
    SUPABASE_ANON_KEY: string;
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
        const supabaseUrl = getVar(c, 'SUPABASE_URL');
        const supabaseKey = getVar(c, 'SUPABASE_ANON_KEY');
        const supabase = getSupabaseHttpClient(supabaseUrl, supabaseKey);

        const { data: mediaReviews, error } = await supabase
            .from('reviews')
            .select('id, user_id, media_id, rating, comment, spoiler, likes, created_at, updated_at, user:user_id(name, image)')
            .eq('media_id', mediaId)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        const data = (mediaReviews || []).map((r: any) => ({
            id: r.id,
            userId: r.user_id,
            mediaId: r.media_id,
            rating: r.rating,
            comment: r.comment,
            spoiler: r.spoiler,
            likes: r.likes,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
            user: {
                name: r.user?.name || null,
                image: r.user?.image || null,
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
            const supabaseUrl = getVar(c, 'SUPABASE_URL');
            const supabaseKey = getVar(c, 'SUPABASE_ANON_KEY');
            const supabase = getSupabaseHttpClient(supabaseUrl, supabaseKey);

            const { data: existing } = await supabase
                .from('reviews')
                .select('id')
                .eq('media_id', data.mediaId)
                .eq('user_id', userId)
                .maybeSingle();

            if (existing) {
                return c.json({ success: false, error: 'Vous avez déjà posté une review pour ce média' }, 400);
            }

            const { data: result, error } = await supabase
                .from('reviews')
                .insert({
                    user_id: userId,
                    media_id: data.mediaId,
                    rating: data.rating,
                    comment: data.comment || null,
                    spoiler: data.spoiler || false,
                })
                .select()
                .single();

            if (error) throw error;

            return c.json({
                success: true,
                data: result
            }, 201);
        } catch (error: any) {
            console.error('Erreur création review:', { message: error?.message, cause: error?.cause, stack: error?.stack });
            return c.json({ success: false, error: 'Erreur lors de la création de la review' }, 500);
        }
    }
);

export default reviewRoutes;
