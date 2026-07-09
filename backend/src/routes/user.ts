import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getSupabaseClient } from '../db/singleton';
import { user, favorites, watchHistory } from '../db/supabase/schema';
import { eq, and, inArray, desc } from 'drizzle-orm';
import { verifyCloudflareTurnstile } from '../lib/turnstile';

type Bindings = {
    SUPABASE_DATABASE_URL: string;
    TURNSTILE_SECRET_KEY?: string;
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

const userRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const getVar = (c: any, key: string) => {
    const val = c.env?.[key] || (process.env as any)[key];
    if (!val && c.env?.ENVIRONMENT === 'production') {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return val;
};

// ========== GET /api/user/profile/:id (PUBLIC) ==========
userRoutes.get('/profile/:id', zValidator('param', z.object({ id: z.string() })), async (c) => {
    const { id: userId } = c.req.valid('param' as any);
    try {
        const dbUrl = getVar(c, 'SUPABASE_DATABASE_URL');
        const db = getSupabaseClient(dbUrl);

        const result = await db.select({
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
            createdAt: user.createdAt,
        })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);

        if (result.length === 0) {
            return c.json({ success: false, error: 'Utilisateur non trouvé' }, 404);
        }

        return c.json({
            success: true,
            data: result[0]
        });
    } catch (error: any) {
        console.error('Erreur profil:', error.message);
        return c.json({ success: false, error: 'Erreur serveur' }, 500);
    }
});

// ========== PROTECTED ROUTES ==========
function authCheck(c: any, next: any) {
    const sessionUser = c.get('user');
    if (!sessionUser) {
        return c.json({ success: false, error: 'Non authentifié' }, 401);
    }
    return next();
}

userRoutes.use('/favorites', async (c, next) => {
    if (c.req.method === 'POST' || c.req.method === 'DELETE') {
        const secret = c.env?.TURNSTILE_SECRET_KEY || process.env.TURNSTILE_SECRET_KEY || '';
        const token = c.req.header('X-Turnstile-Token');
        if (!token || !secret) {
            return c.json({ success: false, error: 'Anti-bot verification required' }, 403);
        }
        const valid = await verifyCloudflareTurnstile(token, secret);
        if (!valid) {
            return c.json({ success: false, error: 'Anti-bot verification failed' }, 403);
        }
    }
    if (c.req.method === 'GET' || c.req.method === 'POST' || c.req.method === 'DELETE') {
        return authCheck(c, next);
    }
    await next();
});

userRoutes.use('/history', authCheck);

// ========== GET /api/user/favorites ==========
userRoutes.get('/favorites', async (c) => {
    const sessionUser = c.get('user')!;
    const userId = sessionUser.id;

    try {
        const dbUrl = getVar(c, 'SUPABASE_DATABASE_URL');
        const db = getSupabaseClient(dbUrl);

        const userFavorites = await db.select()
            .from(favorites)
            .where(eq(favorites.userId, userId));

        return c.json({
            success: true,
            data: userFavorites
        });
    } catch (error: any) {
        console.error('Erreur favoris:', error.message);
        return c.json({ success: false, error: 'Erreur serveur' }, 500);
    }
});

// ========== POST /api/user/favorites ==========
const addFavoriteSchema = z.object({
    mediaId: z.string().min(1)
});

userRoutes.post('/favorites', zValidator('json', addFavoriteSchema as any), async (c) => {
    const sessionUser = c.get('user')!;
    const userId = sessionUser.id;
    const { mediaId } = c.req.valid('json');

    try {
        const dbUrl = getVar(c, 'SUPABASE_DATABASE_URL');
        const db = getSupabaseClient(dbUrl);

        const existing = await db.select()
            .from(favorites)
            .where(and(eq(favorites.userId, userId), eq(favorites.mediaId, mediaId)))
            .limit(1);

        if (existing.length > 0) {
            return c.json({ success: true, message: 'Déjà en favoris' });
        }

        await db.insert(favorites).values({
            userId,
            mediaId
        });

        return c.json({ success: true, message: 'Favori ajouté sur Supabase' });
    } catch (error: any) {
        console.error('Erreur ajout favori Supabase:', error.message);
        return c.json({ success: false, error: 'Erreur serveur' }, 500);
    }
});

// ========== DELETE /api/user/favorites/:mediaId ==========
userRoutes.delete('/favorites/:mediaId', async (c) => {
    const sessionUser = c.get('user')!;
    const userId = sessionUser.id;
    const mediaId = c.req.param('mediaId');

    try {
        const dbUrl = getVar(c, 'SUPABASE_DATABASE_URL');
        const db = getSupabaseClient(dbUrl);

        await db.delete(favorites)
            .where(and(eq(favorites.userId, userId), eq(favorites.mediaId, mediaId)));

        return c.json({ success: true, message: 'Favori retiré de Supabase' });
    } catch (error: any) {
        console.error('Erreur suppression favori Supabase:', error.message);
        return c.json({ success: false, error: 'Erreur serveur' }, 500);
    }
});

// ========== POST /api/user/sync (BATCH) ==========
const syncSchema = z.object({
    favorites: z.array(z.object({
        mediaId: z.string().min(1),
        action: z.enum(['add', 'remove']),
    })).optional().default([]),
    history: z.array(z.object({
        mediaId: z.string().min(1),
        type: z.string().min(1),
        title: z.string().min(1),
        slug: z.string().min(1),
        posterUrl: z.string().optional(),
        visitedAt: z.number(),
    })).optional().default([]),
});

userRoutes.use('/sync', async (c, next) => {
    const secret = c.env?.TURNSTILE_SECRET_KEY || process.env.TURNSTILE_SECRET_KEY || '';
    const token = c.req.header('X-Turnstile-Token');
    if (!token || !secret) {
        return c.json({ success: false, error: 'Anti-bot verification required' }, 403);
    }
    const valid = await verifyCloudflareTurnstile(token, secret);
    if (!valid) {
        return c.json({ success: false, error: 'Anti-bot verification failed' }, 403);
    }
    const sessionUser = c.get('user');
    if (!sessionUser) {
        return c.json({ success: false, error: 'Non authentifié' }, 401);
    }
    await next();
});

userRoutes.post('/sync', zValidator('json', syncSchema as any), async (c) => {
    const sessionUser = c.get('user')!;
    const userId = sessionUser.id;
    const body = c.req.valid('json');

    const results: { favorites: number; history: number } = { favorites: 0, history: 0 };

    try {
        const dbUrl = getVar(c, 'SUPABASE_DATABASE_URL');
        const db = getSupabaseClient(dbUrl);

        // Favorites
        const addOps = body.favorites.filter((f: any) => f.action === 'add');
        const removeOps = body.favorites.filter((f: any) => f.action === 'remove');

        if (addOps.length > 0) {
            const addMediaIds = addOps.map((f: any) => f.mediaId);
            const existing = await db.select({ mediaId: favorites.mediaId })
                .from(favorites)
                .where(and(eq(favorites.userId, userId), inArray(favorites.mediaId, addMediaIds)));

            const existingSet = new Set(existing.map((r: any) => r.mediaId));
            const toInsert = addOps
                .filter((f: any) => !existingSet.has(f.mediaId))
                .map((f: any) => ({ userId, mediaId: f.mediaId }));

            if (toInsert.length > 0) {
                await db.insert(favorites).values(toInsert);
                results.favorites = toInsert.length;
            }
        }

        if (removeOps.length > 0) {
            const removeMediaIds = removeOps.map((f: any) => f.mediaId);
            const result = await db.delete(favorites)
                .where(and(eq(favorites.userId, userId), inArray(favorites.mediaId, removeMediaIds)));
            results.favorites = (result as any).rowCount || removeOps.length;
        }

        // History
        if (body.history.length > 0) {
            const historyValues = body.history.map((h: any) => ({
                userId,
                mediaId: h.mediaId,
                type: h.type,
                title: h.title,
                slug: h.slug,
                posterUrl: h.posterUrl || null,
                visitedAt: new Date(h.visitedAt),
            }));

            // Upsert par mediaId: supprime l'ancienne entree puis insert la nouvelle
            for (const val of historyValues) {
                await db.delete(watchHistory)
                    .where(and(eq(watchHistory.userId, userId), eq(watchHistory.mediaId, val.mediaId)));
            }
            if (historyValues.length > 0) {
                await db.insert(watchHistory).values(historyValues);
            }
            results.history = historyValues.length;
        }

        return c.json({ success: true, data: results });
    } catch (error: any) {
        console.error('Erreur sync batch:', error.message);
        return c.json({ success: false, error: 'Erreur serveur' }, 500);
    }
});

// ========== GET /api/user/history ==========
userRoutes.get('/history', async (c) => {
    const sessionUser = c.get('user')!;
    const userId = sessionUser.id;

    try {
        const dbUrl = getVar(c, 'SUPABASE_DATABASE_URL');
        const db = getSupabaseClient(dbUrl);

        const entries = await db.select()
            .from(watchHistory)
            .where(eq(watchHistory.userId, userId))
            .orderBy(desc(watchHistory.visitedAt))
            .limit(100);

        return c.json({ success: true, data: entries });
    } catch (error: any) {
        console.error('Erreur historique:', error.message);
        return c.json({ success: false, error: 'Erreur serveur' }, 500);
    }
});

export default userRoutes;
