import { createMiddleware } from 'hono/factory';
import { getSupabaseClient } from '../db/singleton';
import { adminUsers } from '../db/supabase/schema';
import { eq } from 'drizzle-orm';

export const adminMiddleware = createMiddleware<{
    Bindings: { SUPABASE_DATABASE_URL: string };
    Variables: {
        user: { id: string; name: string; email: string } | null;
        session: { userId: string } | null;
    };
}>(async (c, next) => {
    const user = c.get('user');
    const session = c.get('session');

    if (!user || !session) {
        return c.json({ error: 'Unauthorized' }, 401);
    }

    try {
        const dbUrl = c.env?.SUPABASE_DATABASE_URL || process.env.SUPABASE_DATABASE_URL || '';
        if (!dbUrl) {
            return c.json({ error: 'Internal error' }, 500);
        }
        const db = getSupabaseClient(dbUrl);
        const [admin] = await db
            .select({ id: adminUsers.id })
            .from(adminUsers)
            .where(eq(adminUsers.userId, user.id))
            .limit(1);

        if (!admin) {
            return c.json({ error: 'Forbidden' }, 403);
        }
    } catch {
        return c.json({ error: 'Forbidden' }, 403);
    }

    await next();
});
