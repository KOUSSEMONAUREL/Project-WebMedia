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

adminRoutes.get('/recent', async (c) => {
    try {
        const tursoUrl = c.env?.TURSO_DATABASE_URL || process.env.TURSO_DATABASE_URL || '';
        if (!tursoUrl) return c.json([]);
        const client = createClient({ url: tursoUrl, authToken: c.env?.TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || '' });
        const rs = await client.execute(`
            SELECT id, title, type, image, created_at
            FROM medias
            ORDER BY created_at DESC
            LIMIT 10
        `);
        client.close();
        return c.json(rs.rows);
    } catch (err) {
        console.error('[admin/recent]', err);
        return c.json([]);
    }
});

adminRoutes.get('/by-type', async (c) => {
    try {
        const tursoUrl = c.env?.TURSO_DATABASE_URL || process.env.TURSO_DATABASE_URL || '';
        if (!tursoUrl) return c.json([]);
        const client = createClient({ url: tursoUrl, authToken: c.env?.TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || '' });
        const rs = await client.execute(`
            SELECT type, COUNT(*) as count
            FROM medias
            GROUP BY type
            ORDER BY count DESC
        `);
        client.close();
        return c.json(rs.rows);
    } catch (err) {
        console.error('[admin/by-type]', err);
        return c.json([]);
    }
});

// ========== MEDIAS CRUD ==========

adminRoutes.put('/medias/:id', async (c) => {
    try {
        const tursoUrl = c.env?.TURSO_DATABASE_URL || process.env.TURSO_DATABASE_URL || '';
        if (!tursoUrl) return c.json({ error: 'No DB' }, 500);
        const id = c.req.param('id');
        const body = await c.req.json();
        const client = createClient({ url: tursoUrl, authToken: c.env?.TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || '' });

        const setClauses: string[] = [];
        const values: any[] = [];

        const allowed = ['title', 'original_title', 'slug', 'synopsis', 'year', 'author',
            'poster_url', 'backdrop_url', 'rating', 'status', 'type', 'genres',
            'trailer_url', 'tagline', 'studios', 'episode_count', 'active_links_count'];

        for (const key of allowed) {
            if (body[key] !== undefined) {
                setClauses.push(`${key} = ?`);
                values.push(body[key]);
            }
        }

        if (setClauses.length === 0) {
            client.close();
            return c.json({ error: 'No fields to update' }, 400);
        }

        setClauses.push('updated_at = ?');
        values.push(Math.floor(Date.now() / 1000));
        values.push(id);

        await client.execute({
            sql: `UPDATE medias SET ${setClauses.join(', ')} WHERE id = ?`,
            args: values,
        });
        client.close();
        return c.json({ success: true });
    } catch (err) {
        console.error('[admin/medias/put]', err);
        return c.json({ error: 'Update failed' }, 500);
    }
});

adminRoutes.post('/medias', async (c) => {
    try {
        const tursoUrl = c.env?.TURSO_DATABASE_URL || process.env.TURSO_DATABASE_URL || '';
        if (!tursoUrl) return c.json({ error: 'No DB' }, 500);
        const body = await c.req.json();
        if (!body.id || !body.title || !body.type) {
            return c.json({ error: 'id, title, type required' }, 400);
        }

        const client = createClient({ url: tursoUrl, authToken: c.env?.TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || '' });

        const now = Math.floor(Date.now() / 1000);
        await client.execute({
            sql: `INSERT INTO medias (id, type, title, slug, synopsis, year, poster_url, backdrop_url,
                  rating, status, genres, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
                body.id, body.type, body.title, body.slug || body.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                body.synopsis || null, body.year || null, body.poster_url || null, body.backdrop_url || null,
                body.rating || null, body.status || 'unknown', body.genres || null, now, now,
            ],
        });
        client.close();
        return c.json({ success: true, id: body.id });
    } catch (err) {
        console.error('[admin/medias/post]', err);
        return c.json({ error: 'Create failed' }, 500);
    }
});

adminRoutes.delete('/medias/:id', async (c) => {
    try {
        const tursoUrl = c.env?.TURSO_DATABASE_URL || process.env.TURSO_DATABASE_URL || '';
        if (!tursoUrl) return c.json({ error: 'No DB' }, 500);
        const id = c.req.param('id');
        const client = createClient({ url: tursoUrl, authToken: c.env?.TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || '' });
        await client.execute({ sql: 'DELETE FROM medias WHERE id = ?', args: [id] });
        client.close();
        return c.json({ success: true });
    } catch (err) {
        console.error('[admin/medias/delete]', err);
        return c.json({ error: 'Delete failed' }, 500);
    }
});

// ========== EPISODES CRUD ==========

adminRoutes.put('/episodes/:id', async (c) => {
    try {
        const tursoUrl = c.env?.TURSO_DATABASE_URL || process.env.TURSO_DATABASE_URL || '';
        if (!tursoUrl) return c.json({ error: 'No DB' }, 500);
        const id = c.req.param('id');
        const body = await c.req.json();
        const client = createClient({ url: tursoUrl, authToken: c.env?.TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || '' });

        const setClauses: string[] = [];
        const values: any[] = [];
        const allowed = ['media_id', 'season_number', 'episode_number', 'title', 'synopsis', 'air_date', 'thumbnail_url', 'duration'];

        for (const key of allowed) {
            if (body[key] !== undefined) {
                setClauses.push(`${key} = ?`);
                values.push(body[key]);
            }
        }

        if (setClauses.length === 0) {
            client.close();
            return c.json({ error: 'No fields to update' }, 400);
        }

        values.push(id);
        await client.execute({
            sql: `UPDATE episodes SET ${setClauses.join(', ')} WHERE id = ?`,
            args: values,
        });
        client.close();
        return c.json({ success: true });
    } catch (err) {
        console.error('[admin/episodes/put]', err);
        return c.json({ error: 'Update failed' }, 500);
    }
});

adminRoutes.delete('/episodes/:id', async (c) => {
    try {
        const tursoUrl = c.env?.TURSO_DATABASE_URL || process.env.TURSO_DATABASE_URL || '';
        if (!tursoUrl) return c.json({ error: 'No DB' }, 500);
        const id = c.req.param('id');
        const client = createClient({ url: tursoUrl, authToken: c.env?.TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || '' });
        await client.execute({ sql: 'DELETE FROM episodes WHERE id = ?', args: [id] });
        client.close();
        return c.json({ success: true });
    } catch (err) {
        console.error('[admin/episodes/delete]', err);
        return c.json({ error: 'Delete failed' }, 500);
    }
});

// ========== LIENS CRUD ==========

adminRoutes.put('/liens/:id', async (c) => {
    try {
        const tursoUrl = c.env?.TURSO_DATABASE_URL || process.env.TURSO_DATABASE_URL || '';
        if (!tursoUrl) return c.json({ error: 'No DB' }, 500);
        const id = c.req.param('id');
        const body = await c.req.json();
        const client = createClient({ url: tursoUrl, authToken: c.env?.TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || '' });

        const setClauses: string[] = [];
        const values: any[] = [];
        const allowed = ['media_id', 'episode_id', 'source_site', 'player_host', 'url',
            'quality', 'language', 'has_subtitles', 'is_active', 'fail_count'];

        for (const key of allowed) {
            if (body[key] !== undefined) {
                setClauses.push(`${key} = ?`);
                values.push(body[key]);
            }
        }

        if (setClauses.length === 0) {
            client.close();
            return c.json({ error: 'No fields to update' }, 400);
        }

        values.push(id);
        await client.execute({
            sql: `UPDATE liens SET ${setClauses.join(', ')} WHERE id = ?`,
            args: values,
        });
        client.close();
        return c.json({ success: true });
    } catch (err) {
        console.error('[admin/liens/put]', err);
        return c.json({ error: 'Update failed' }, 500);
    }
});

adminRoutes.delete('/liens/:id', async (c) => {
    try {
        const tursoUrl = c.env?.TURSO_DATABASE_URL || process.env.TURSO_DATABASE_URL || '';
        if (!tursoUrl) return c.json({ error: 'No DB' }, 500);
        const id = c.req.param('id');
        const client = createClient({ url: tursoUrl, authToken: c.env?.TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || '' });
        await client.execute({ sql: 'DELETE FROM liens WHERE id = ?', args: [id] });
        client.close();
        return c.json({ success: true });
    } catch (err) {
        console.error('[admin/liens/delete]', err);
        return c.json({ error: 'Delete failed' }, 500);
    }
});

// ========== JOBS ==========

adminRoutes.get('/jobs', async (c) => {
    try {
        const supabaseUrl = c.env?.SUPABASE_DATABASE_URL || process.env.SUPABASE_DATABASE_URL || '';
        if (!supabaseUrl) return c.json([]);
        const supabase = getSupabaseClient(supabaseUrl);
        const jobs = await supabase
            .select()
            .from(scrapingJobs)
            .order(sql`created_at desc`)
            .limit(200);
        return c.json(jobs);
    } catch (err) {
        console.error('[admin/jobs]', err);
        return c.json([]);
    }
});

adminRoutes.post('/jobs/:id/retry', async (c) => {
    try {
        const supabaseUrl = c.env?.SUPABASE_DATABASE_URL || process.env.SUPABASE_DATABASE_URL || '';
        if (!supabaseUrl) return c.json({ error: 'No DB' }, 500);
        const id = c.req.param('id');
        const supabase = getSupabaseClient(supabaseUrl);
        await supabase
            .update({ status: 'pending', attempts: 0, last_error: null, locked_at: null })
            .from(scrapingJobs)
            .where(eq(scrapingJobs.id, id));
        return c.json({ success: true });
    } catch (err) {
        console.error('[admin/jobs/retry]', err);
        return c.json({ error: 'Retry failed' }, 500);
    }
});

export default adminRoutes;
