import { Hono } from 'hono';
import { adminMiddleware } from '../middleware/admin';
import { getSupabaseClient } from '../db/singleton';
import { createClient } from '@libsql/client';
import { scrapingJobs } from '../db/supabase/schema';
import { sql, eq } from 'drizzle-orm';

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

adminRoutes.get('/stats', async (c) => {
    try {
        const tursoUrl = c.env?.TURSO_DATABASE_URL || process.env.TURSO_DATABASE_URL || '';
        const tursoToken = c.env?.TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || '';
        const supabaseUrl = c.env?.SUPABASE_DATABASE_URL || process.env.SUPABASE_DATABASE_URL || '';

        let mediaCount = 0;
        let episodeCount = 0;
        let lienCount = 0;
        let pendingJobs = 0;

        if (tursoUrl) {
            const client = createClient({ url: tursoUrl, authToken: tursoToken });
            const rs = await client.execute(`
                SELECT (SELECT COUNT(*) FROM medias) as medias,
                       (SELECT COUNT(*) FROM episodes) as episodes,
                       (SELECT COUNT(*) FROM liens) as liens
            `);
            const row = rs.rows[0] as any;
            mediaCount = Number(row?.medias || 0);
            episodeCount = Number(row?.episodes || 0);
            lienCount = Number(row?.liens || 0);
            client.close();
        }

        if (supabaseUrl) {
            const supabase = getSupabaseClient(supabaseUrl);
            const jobs = await supabase
                .select({ count: sql<number>`count(*)` })
                .from(scrapingJobs)
                .where(eq(scrapingJobs.status, 'pending'));
            pendingJobs = Number(jobs[0]?.count || 0);
        }

        return c.json({ medias: mediaCount, episodes: episodeCount, liens: lienCount, pendingJobs });
    } catch (err) {
        console.error('[admin/stats]', err);
        return c.json({ error: 'Stats fetch failed' }, 500);
    }
});

export default adminRoutes;
