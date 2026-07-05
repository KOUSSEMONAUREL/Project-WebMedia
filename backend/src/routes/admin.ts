import { Hono } from 'hono';
import { adminMiddleware } from '../middleware/admin';

type Bindings = {
    SUPABASE_DATABASE_URL: string;
    NEON_DATABASE_URL: string;
    TURSO_DATABASE_URL: string;
    TURSO_AUTH_TOKEN: string;
    INTERNAL_API_KEY: string;
};

type Variables = {
    user: { id: string; name: string; email: string };
    session: { userId: string };
};

const adminRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

adminRoutes.use('*', adminMiddleware);

adminRoutes.get('/check', (c) => {
    return c.json({ admin: true });
});

export default adminRoutes;
