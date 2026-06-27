import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getSupabaseClient } from '../db/singleton';
import { users, reviews, favorites } from '../db/supabase/schema';
import { eq, and } from 'drizzle-orm';
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

const userRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Helper universel pour les variables d'env
const getVar = (c: any, key: string) => {
    const val = c.env?.[key] || (process.env as any)[key];
    if (!val && c.env?.ENVIRONMENT === 'production') {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return val;
};

// ========== GET /api/user/profile/:id (PUBLIC) ==========
userRoutes.get('/profile/:id', zValidator('param', z.object({ id: z.string().uuid() })), async (c) => {
    const { id: userId } = c.req.valid('param' as any);
    const dbUrl = getVar(c, 'SUPABASE_DATABASE_URL');
    try {
        const db = getSupabaseClient(dbUrl);

        const result = await db.select({
            id: users.id,
            username: users.username,
            createdAt: users.createdAt,
            // Ne pas renvoyer 'email' ou 'passwordHash' publiquement
        })
        .from(users)
        .where(eq(users.id, userId))
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

// Middleware JWT
userRoutes.use('*', (c, next) => {
    const jwtMiddleware = jwt({
        secret: getVar(c, 'JWT_SECRET'),
        alg: 'HS256'
    });
    return jwtMiddleware(c, next);
});

// ========== GET /api/user/favorites ==========
userRoutes.get('/favorites', async (c) => {
    const userId = c.get('jwtPayload').id;
    const dbUrl = getVar(c, 'SUPABASE_DATABASE_URL');

    try {
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
