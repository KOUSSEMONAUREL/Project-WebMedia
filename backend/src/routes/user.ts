import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getSupabaseClient } from '../db/singleton';
import { user, favorites } from '../db/supabase/schema';
import { eq } from 'drizzle-orm';

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
userRoutes.use('/favorites', async (c, next) => {
    const sessionUser = c.get('user');
    if (!sessionUser) {
        return c.json({ success: false, error: 'Non authentifié' }, 401);
    }
    await next();
});

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

export default userRoutes;
