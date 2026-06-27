import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getSupabaseClient } from '../db/singleton';
import { users } from '../db/supabase/schema';
import { eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import bcrypt from 'bcryptjs';

type Bindings = {
    SUPABASE_DATABASE_URL: string;
    JWT_SECRET: string;
};

const authRoutes = new Hono<{ Bindings: Bindings }>();

// Helper universel pour les variables d'env
const getVar = (c: any, key: string) => {
    const val = c.env?.[key] || (process.env as any)[key];
    if (!val && c.env?.ENVIRONMENT === 'production') {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return val;
};

// ========== REGISTRATION ==========
const registerSchema = z.object({
    email: z.string().email(),
    username: z.string().min(3),
    password: z.string().min(10),
});

authRoutes.post('/register', zValidator('json', registerSchema as any), async (c) => {
    const { email, username, password } = c.req.valid('json' as any);
    const dbUrl = getVar(c, 'SUPABASE_DATABASE_URL');
    const jwtSecret = getVar(c, 'JWT_SECRET');

    try {
        const db = getSupabaseClient(dbUrl);

        const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (existing.length > 0) {
            return c.json({ success: false, error: 'Email déjà utilisé' }, 400);
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const newUser = await db.insert(users).values({
            email,
            username,
            passwordHash
        }).returning();

        const user = newUser[0];
        const token = await new SignJWT({ id: user.id, email: user.email, jti: crypto.randomUUID() })
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuedAt()
            .setExpirationTime('24h')
            .sign(new TextEncoder().encode(jwtSecret));

        return c.json({
            success: true,
            data: { user: { id: user.id, email: user.email, username: user.username }, token }
        }, 201);
    } catch (error: any) {
        console.error('Erreur register:', error.message);
        return c.json({ success: false, error: 'Erreur serveur' }, 500);
    }
});

// ========== LOGIN ==========
const loginSchema = z.object({
    email: z.string().email(),
    password: z.string(),
});

authRoutes.post('/login', zValidator('json', loginSchema as any), async (c) => {
    const { email, password } = c.req.valid('json' as any);
    const dbUrl = getVar(c, 'SUPABASE_DATABASE_URL');
    const jwtSecret = getVar(c, 'JWT_SECRET');

    try {
        const db = getSupabaseClient(dbUrl);

        const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
        if (result.length === 0) {
            return c.json({ success: false, error: 'Identifiants incorrects' }, 401);
        }

        const user = result[0];
        if (!user.passwordHash) {
            return c.json({ success: false, error: 'Compte incompatible' }, 401);
        }

        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) {
            return c.json({ success: false, error: 'Identifiants incorrects' }, 401);
        }

        const token = await new SignJWT({ id: user.id, email: user.email, jti: crypto.randomUUID() })
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuedAt()
            .setExpirationTime('24h')
            .sign(new TextEncoder().encode(jwtSecret));

        return c.json({
            success: true,
            data: { user: { id: user.id, email: user.email, username: user.username }, token }
        }, 200);
    } catch (error: any) {
        console.error('Erreur login:', error.message);
        return c.json({ success: false, error: 'Erreur serveur' }, 500);
    }
});

export default authRoutes;
