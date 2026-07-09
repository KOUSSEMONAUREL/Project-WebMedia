import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getSupabaseHttpClient } from '../db/singleton';
import { verifyCloudflareTurnstile } from '../lib/turnstile';

type Bindings = {
    SUPABASE_URL: string;
    SUPABASE_ANON_KEY: string;
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
        const supabaseUrl = getVar(c, 'SUPABASE_URL');
        const supabaseKey = getVar(c, 'SUPABASE_ANON_KEY');
        const supabase = getSupabaseHttpClient(supabaseUrl, supabaseKey);

        const { data: result, error } = await supabase
            .from('user')
            .select('id, name, email, image, created_at')
            .eq('id', userId)
            .maybeSingle();

        if (error) throw error;

        if (!result) {
            return c.json({ success: false, error: 'Utilisateur non trouvé' }, 404);
        }

        return c.json({
            success: true,
            data: {
                id: result.id,
                name: result.name,
                email: result.email,
                image: result.image,
                createdAt: result.created_at,
            }
        });
    } catch (error: any) {
        console.error('Erreur profil:', { message: error?.message, cause: error?.cause, stack: error?.stack });
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

async function turnstileAndAuth(c: any, next: any) {
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
}

userRoutes.use('/favorites', turnstileAndAuth);
userRoutes.use('/favorites/*', turnstileAndAuth);
userRoutes.use('/history', authCheck);
userRoutes.use('/history/*', authCheck);

// ========== GET /api/user/favorites ==========
userRoutes.get('/favorites', async (c) => {
    const sessionUser = c.get('user')!;
    const userId = sessionUser.id;

    try {
        const supabaseUrl = getVar(c, 'SUPABASE_URL');
        const supabaseKey = getVar(c, 'SUPABASE_ANON_KEY');
        const supabase = getSupabaseHttpClient(supabaseUrl, supabaseKey);

        const { data: userFavorites, error } = await supabase
            .from('favorites')
            .select('*')
            .eq('user_id', userId);

        if (error) throw error;

        return c.json({
            success: true,
            data: userFavorites || []
        });
    } catch (error: any) {
        console.error('Erreur favoris:', { message: error?.message, cause: error?.cause, stack: error?.stack });
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
        const supabaseUrl = getVar(c, 'SUPABASE_URL');
        const supabaseKey = getVar(c, 'SUPABASE_ANON_KEY');
        const supabase = getSupabaseHttpClient(supabaseUrl, supabaseKey);

        const { data: existing } = await supabase
            .from('favorites')
            .select('media_id')
            .eq('user_id', userId)
            .eq('media_id', mediaId)
            .maybeSingle();

        if (existing) {
            return c.json({ success: true, message: 'Déjà en favoris' });
        }

        const { error } = await supabase
            .from('favorites')
            .insert({ user_id: userId, media_id: mediaId });

        if (error) throw error;

        return c.json({ success: true, message: 'Favori ajouté' });
    } catch (error: any) {
        console.error('Erreur ajout favori:', { message: error?.message, cause: error?.cause, stack: error?.stack });
        return c.json({ success: false, error: 'Erreur serveur' }, 500);
    }
});

// ========== DELETE /api/user/favorites/:mediaId ==========
userRoutes.delete('/favorites/:mediaId', async (c) => {
    const sessionUser = c.get('user')!;
    const userId = sessionUser.id;
    const mediaId = c.req.param('mediaId');

    try {
        const supabaseUrl = getVar(c, 'SUPABASE_URL');
        const supabaseKey = getVar(c, 'SUPABASE_ANON_KEY');
        const supabase = getSupabaseHttpClient(supabaseUrl, supabaseKey);

        const { error } = await supabase
            .from('favorites')
            .delete()
            .eq('user_id', userId)
            .eq('media_id', mediaId);

        if (error) throw error;

        return c.json({ success: true, message: 'Favori retiré' });
    } catch (error: any) {
        console.error('Erreur suppression favori:', { message: error?.message, cause: error?.cause, stack: error?.stack });
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
        const supabaseUrl = getVar(c, 'SUPABASE_URL');
        const supabaseKey = getVar(c, 'SUPABASE_ANON_KEY');
        const supabase = getSupabaseHttpClient(supabaseUrl, supabaseKey);

        // Favorites
        const addOps = body.favorites.filter((f: any) => f.action === 'add');
        const removeOps = body.favorites.filter((f: any) => f.action === 'remove');

        if (addOps.length > 0) {
            const addMediaIds = addOps.map((f: any) => f.mediaId);
            const { data: existing } = await supabase
                .from('favorites')
                .select('media_id')
                .eq('user_id', userId)
                .in('media_id', addMediaIds);

            const existingSet = new Set((existing || []).map((r: any) => r.media_id));
            const toInsert = addOps
                .filter((f: any) => !existingSet.has(f.mediaId))
                .map((f: any) => ({ user_id: userId, media_id: f.mediaId }));

            if (toInsert.length > 0) {
                const { error } = await supabase.from('favorites').insert(toInsert);
                if (!error) results.favorites = toInsert.length;
            }
        }

        if (removeOps.length > 0) {
            const removeMediaIds = removeOps.map((f: any) => f.mediaId);
            const { error } = await supabase
                .from('favorites')
                .delete()
                .eq('user_id', userId)
                .in('media_id', removeMediaIds);
            if (!error) results.favorites = removeOps.length;
        }

        // History
        if (body.history.length > 0) {
            const historyValues = body.history.map((h: any) => ({
                user_id: userId,
                media_id: h.mediaId,
                type: h.type,
                title: h.title,
                slug: h.slug,
                poster_url: h.posterUrl || null,
                visited_at: new Date(h.visitedAt).toISOString(),
            }));

            // Delete old entries for these mediaIds
            const historyMediaIds = historyValues.map((h: any) => h.media_id);
            const { error: delError } = await supabase
                .from('watch_history')
                .delete()
                .eq('user_id', userId)
                .in('media_id', historyMediaIds);
            if (delError) throw delError;

            const { error: insError } = await supabase
                .from('watch_history')
                .insert(historyValues);
            if (insError) throw insError;

            results.history = historyValues.length;
        }

        return c.json({ success: true, data: results });
    } catch (error: any) {
        console.error('Erreur sync batch:', { message: error?.message, cause: error?.cause, stack: error?.stack });
        return c.json({ success: false, error: 'Erreur serveur' }, 500);
    }
});

// ========== GET /api/user/history ==========
userRoutes.get('/history', async (c) => {
    const sessionUser = c.get('user')!;
    const userId = sessionUser.id;

    try {
        const supabaseUrl = getVar(c, 'SUPABASE_URL');
        const supabaseKey = getVar(c, 'SUPABASE_ANON_KEY');
        const supabase = getSupabaseHttpClient(supabaseUrl, supabaseKey);

        const { data: entries, error } = await supabase
            .from('watch_history')
            .select('*')
            .eq('user_id', userId)
            .order('visited_at', { ascending: false })
            .limit(100);

        if (error) throw error;

        return c.json({ success: true, data: entries || [] });
    } catch (error: any) {
        console.error('Erreur historique:', { message: error?.message, cause: error?.cause, stack: error?.stack });
        return c.json({ success: false, error: 'Erreur serveur' }, 500);
    }
});

export default userRoutes;
