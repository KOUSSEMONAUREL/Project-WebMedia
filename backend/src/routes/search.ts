import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getTursoClient, getNeonDb, getSupabaseHttpClient } from '../db/singleton';
import { medias as tursoMedias } from '../db/turso/schema';
import { medias as neonMedias } from '../db/neon/schema';
import { and, eq, like, or, sql } from 'drizzle-orm';
import { searchExternalSources } from '../services/search-advanced';
import { createClient } from '@libsql/client';
import { verifyCloudflareTurnstile } from '../lib/turnstile';

type Bindings = {
    TURSO_DATABASE_URL: string;
    TURSO_AUTH_TOKEN: string;
    SUPABASE_URL: string;
    SUPABASE_ANON_KEY: string;
    TMDB_API_KEY: string;
    GOOGLE_BOOKS_API_KEY: string;
    TWITCH_CLIENT_ID: string;
    TWITCH_CLIENT_SECRET: string;
    GITHUB_TOKEN: string;
    NEON_DATABASE_URL: string;
    HYPERDRIVE: Hyperdrive;
    DB: D1Database;
    KV: KVNamespace;
    UPSTASH_REDIS_REST_URL: string;
    UPSTASH_REDIS_REST_TOKEN: string;
    TURNSTILE_SECRET_KEY: string;
  };

const searchRoutes = new Hono<{ Bindings: Bindings }>();

const TYPE_MAP: Record<string, string> = {
  film: 'movie',
  jeu: 'game',
};
const mapType = (t: string) => TYPE_MAP[t] || t;

const getVar = (c: any, key: string) => {
    const val = c.env?.[key] || (process.env as any)[key];
    if (!val && c.env?.ENVIRONMENT === 'production') {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return val;
};

const getTursoDb = (c: any) => {
    const url = getVar(c, 'TURSO_DATABASE_URL');
    const token = getVar(c, 'TURSO_AUTH_TOKEN');
    return getTursoClient(url, token);
};

function normalizeQuery(q: string): string {
    return q.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

const searchSchema = z.object({
    q: z.string().min(10).max(200),
    type: z.enum(['film', 'serie', 'anime', 'jeu', 'webtoon', 'book', 'novel', 'all']).optional(),
    year: z.coerce.number().int().min(1900).max(2100).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    offset: z.coerce.number().int().min(0).max(100).optional().default(0),
});

// ========== GET /api/search ==========
searchRoutes.get(
    '/',
    zValidator('query', searchSchema as any),
    async (c) => {
        const { q, type, year, limit, offset } = c.req.valid('query' as any);

        try {
            c.header('Cache-Control', 'public, max-age=60');
            const db = getTursoDb(c);

            const searchQ = normalizeQuery(q);

            let searchFilters: any[] = [
                or(
                    like(tursoMedias.title, `%${searchQ}%`),
                    like(tursoMedias.originalTitle, `%${searchQ}%`)
                )
            ];

            if (type && type !== 'all') {
                searchFilters.push(eq(tursoMedias.type, mapType(type as string)));
            }

            if (year) {
                searchFilters.push(eq(tursoMedias.year, year));
            }

            const results = await db.select({
                    id: tursoMedias.id,
                    title: tursoMedias.title,
                    slug: tursoMedias.slug,
                    type: tursoMedias.type,
                    posterUrl: tursoMedias.posterUrl,
                    year: tursoMedias.year,
                    rating: tursoMedias.rating,
                })
                .from(tursoMedias)
                .where(and(...searchFilters))
                .limit(limit)
                .offset(offset);

            return c.json({
                success: true,
                query: q,
                data: results,
                limit,
                offset
            });
        } catch (error: any) {
            console.error('Erreur recherche:', error.message);
            return c.json({
                success: false,
                error: 'Erreur lors de la recherche'
            }, 500);
        }
    }
);

const WORKER_TYPE_MAP: Record<string, string> = {
  jeu: 'playwright',
  game: 'playwright',
  webtoon: 'webtoon',
  comic: 'webtoon',
  manga: 'webtoon',
  novel: 'novel',
};

async function queueScrapingJob(c: any, mediaId: string, mediaType: string, title: string, slug: string): Promise<string | null> {
  const workerType = WORKER_TYPE_MAP[mediaType];
  if (!workerType) return null;

  const supabase = getSupabaseHttpClient(getVar(c, 'SUPABASE_URL'), getVar(c, 'SUPABASE_ANON_KEY'));
  const { data, error } = await supabase
    .from('scraping_jobs')
    .insert({ media_id: mediaId, media_type: mediaType, worker_type: workerType, title, slug, status: 'pending', priority: 1 })
    .select('id')
    .single();

  if (error) {
    console.error('Erreur queue scraping job:', error);
    return null;
  }
  return data?.id || null;
}

async function dispatchGitHubAction(c: any, workerType: string, title: string): Promise<string | null> {
  const token = getVar(c, 'GITHUB_TOKEN');
  if (!token) return null;

  const workflowFile: Record<string, string> = {
    playwright: 'playwright-scraper.yml',
    webtoon: 'webtoon-scraper.yml',
    novel: 'novel-scraper.yml',
  };

  const file = workflowFile[workerType];
  if (!file) return null;

  try {
    const res = await fetch(
      `https://api.github.com/repos/KOUSSEMONAUREL/Project-WebMedia/actions/workflows/${file}/dispatches`,
      {
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main', inputs: { title } }),
      }
    );
    if (!res.ok) {
      const body = await res.text();
      console.error(`GitHub dispatch failed (${res.status}): ${body}`);
      return null;
    }
    const jobId = crypto.randomUUID();
    await c.env.KV.put(`ga_dispatch:${jobId}`, JSON.stringify({ title, workerType, status: 'pending', dispatchedAt: Date.now() }));
    return jobId;
  } catch (e: any) {
    console.error('GitHub dispatch error:', e.message);
    return null;
  }
}

const advancedSchema = z.object({
  q: z.string().min(10).max(200),
  type: z.enum(['film', 'serie', 'anime', 'jeu', 'webtoon', 'book', 'novel', 'all']).optional(),
});

async function getRedisRestClient(c: any) {
  const url = getVar(c, 'UPSTASH_REDIS_REST_URL');
  const token = getVar(c, 'UPSTASH_REDIS_REST_TOKEN');
  return {
    url: url.replace(/\/$/, ''),
    headers: { Authorization: `Bearer ${token}` },
  };
}

async function acquireSearchLock(c: any, ip: string): Promise<boolean> {
  try {
    const redis = await getRedisRestClient(c);
    const lockKey = `lock:search-advanced:${ip}`;
    const res = await fetch(`${redis.url}/set/${lockKey}/1/EX/120/NX`, {
      headers: redis.headers,
    });
    const data = await res.json() as any;
    return data.result === 'OK';
  } catch {
    return true;
  }
}

async function releaseSearchLock(c: any, ip: string): Promise<void> {
  try {
    const redis = await getRedisRestClient(c);
    const lockKey = `lock:search-advanced:${ip}`;
    await fetch(`${redis.url}/del/${lockKey}`, { headers: redis.headers });
  } catch { /* best effort */ }
}

// ========== GET /api/search/advanced ==========
searchRoutes.get(
  '/advanced',
  zValidator('query', advancedSchema as any),
  async (c) => {
    const { q, type } = c.req.valid('query' as any);
    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

    const acquired = await acquireSearchLock(c, ip);
    if (!acquired) {
      return c.json({
        success: false,
        error: 'Une recherche avancee est deja en cours. Reessaye dans quelques secondes.',
      }, 429);
    }

    try {
      const turnstileToken = c.req.query('turnstile_token') || '';
      const secret = getVar(c, 'TURNSTILE_SECRET_KEY');
      if (turnstileToken && secret) {
        const valid = await verifyCloudflareTurnstile(turnstileToken, secret);
        if (!valid) {
          releaseSearchLock(c, ip);
          return c.json({ success: false, error: 'Captcha invalide' }, 403);
        }
      }

      const db = getTursoDb(c);
      const searchQ = normalizeQuery(q);
      let dbFilters: any[] = [or(like(tursoMedias.title, `%${searchQ}%`), like(tursoMedias.originalTitle, `%${searchQ}%`))];
      if (type && type !== 'all') {
        dbFilters.push(eq(tursoMedias.type, mapType(type)));
      }

      const dbResults = await db.select({
        id: tursoMedias.id,
        title: tursoMedias.title,
        slug: tursoMedias.slug,
        type: tursoMedias.type,
        posterUrl: tursoMedias.posterUrl,
        year: tursoMedias.year,
        rating: tursoMedias.rating,
        synopsis: tursoMedias.synopsis,
        externalId: tursoMedias.externalId,
        activeLinksCount: tursoMedias.activeLinksCount,
        metadataSource: tursoMedias.metadataSource,
      })
      .from(tursoMedias)
      .where(and(...dbFilters))
        .limit(20);

      const externalResults = searchQ.length >= 3 ? await searchExternalSources(q, type, c.env) : [];
      const existingKeys = new Set(dbResults.map(m => m.externalId || m.id));
      const uniqueExternal = externalResults.filter(r => !existingKeys.has(r.externalId || ''));

      const nonStreaming = ['jeu', 'game', 'webtoon', 'comic', 'manga', 'novel'];
      const queuedJobs: string[] = [];
      const dispatchedJobs: string[] = [];

      for (const m of dbResults) {
        if (nonStreaming.includes(m.type) && (m.activeLinksCount || 0) === 0) {
          const jobId = await queueScrapingJob(c, m.id, m.type, m.title, m.slug);
          if (jobId) queuedJobs.push(jobId);
        }
      }

      const createdMediaMap = new Map<string, string>();

      for (const r of uniqueExternal) {
        const wt = WORKER_TYPE_MAP[r.type];
        if (!wt) continue;

        let mediaId = r.externalId || r.slug || '';

        if (nonStreaming.includes(r.type)) {
          try {
            const connStr = getVar(c, 'NEON_DATABASE_URL');
            const hyperdrive = c.env?.HYPERDRIVE;
            const db = getNeonDb(connStr, hyperdrive) as any;

            // Dedup : verifie si un media existe deja avec cet externalId
            if (r.externalId) {
              const existing = await db.select({ id: neonMedias.id })
                .from(neonMedias)
                .where(eq(neonMedias.externalId, r.externalId))
                .limit(1);
              if (existing.length > 0) {
                mediaId = existing[0].id;
                createdMediaMap.set(r.externalId || r.slug || '', mediaId);
                const jobId = await queueScrapingJob(c, mediaId, r.type, r.title, r.slug || '');
                if (jobId) queuedJobs.push(jobId);
                continue;
              }
            }

            mediaId = crypto.randomUUID();
            await db.insert(neonMedias).values({
              id: mediaId,
              title: r.title,
              type: r.type,
              slug: r.slug,
              synopsis: r.synopsis || null,
              year: r.year || null,
              posterUrl: r.posterUrl || null,
              rating: r.rating ? String(r.rating) : null,
              externalId: r.externalId || null,
              metadataSource: r.metadataSource || 'external',
              activeLinksCount: 0,
              createdAt: new Date(),
              updatedAt: new Date(),
            });

            if (c.env?.DB) {
              await c.env.DB.prepare(`
                INSERT INTO media_state (media_id, type, title, slug, metadata_ok, active_links, has_content, next_scrape, scrape_priority)
                VALUES (?, ?, ?, ?, 1, 0, 0, ?, 1)
                ON CONFLICT(media_id) DO UPDATE SET
                  title = COALESCE(excluded.title, title),
                  slug = COALESCE(excluded.slug, slug),
                  metadata_ok = 1
              `).bind(mediaId, r.type, r.title, r.slug, Date.now() + 10000).run();
            }

            const tursoUrl = c.env?.TURSO_DATABASE_URL || '';
            const tursoToken = c.env?.TURSO_AUTH_TOKEN || '';
            if (tursoUrl && tursoToken) {
              let synced = false;
              for (let attempt = 0; attempt < 3; attempt++) {
                try {
                  const turso = createClient({ url: tursoUrl, authToken: tursoToken });
                  await turso.execute(
                    'INSERT OR REPLACE INTO medias (id, external_id, type, title, slug, synopsis, year, poster_url, rating, metadata_source, active_links_count, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                    [mediaId, r.externalId || null, r.type, r.title, r.slug ?? '', r.synopsis || null, r.year ?? null, r.posterUrl ?? null, r.rating?.toString() || null, r.metadataSource || 'external', 0, new Date().toISOString(), new Date().toISOString()]
                  );
                  await turso.close();
                  synced = true;
                  break;
                } catch (tursoError: any) {
                  if (attempt < 2) await new Promise(r2 => setTimeout(r2, 500));
                  if (attempt === 2) console.warn(`[SearchAdv] Turso sync failed after 3 attempts: ${tursoError.message}`);
                }
              }
              if (!synced) {
                // Fallback: queue un job de sync differe
                try {
                  const kv = c.env?.KV;
                  if (kv) {
                    const existing = await kv.get('pending_turso_syncs');
                    const pending = existing ? JSON.parse(existing) : [];
                    pending.push({ mediaId, type: r.type, title: r.title, slug: r.slug, synopsis: r.synopsis, year: r.year, posterUrl: r.posterUrl, rating: r.rating, metadataSource: r.metadataSource, externalId: r.externalId });
                    await kv.put('pending_turso_syncs', JSON.stringify(pending.slice(-50)));
                  }
                } catch { /* best effort */ }
              }
            }

            createdMediaMap.set(r.externalId || r.slug || '', mediaId);
          } catch (createError: any) {
            console.error(`[SearchAdv] Failed to create media '${r.title}': ${createError.message}`);
            continue;
          }
        }

        const jobId = await queueScrapingJob(c, mediaId, r.type, r.title, r.slug || '');
        if (jobId) queuedJobs.push(jobId);

        const dispatchId = await dispatchGitHubAction(c, wt, r.title);
        if (dispatchId) dispatchedJobs.push(dispatchId);
      }

      const results = [
        ...dbResults.map(m => ({
          id: m.id,
          title: m.title,
          slug: m.slug,
          type: m.type,
          posterUrl: m.posterUrl,
          year: m.year,
          rating: m.rating ? parseFloat(m.rating) : undefined,
          synopsis: m.synopsis,
          inDb: true,
          linksCount: m.activeLinksCount || 0,
        })),
        ...uniqueExternal.map(r => {
          const key = r.externalId || r.slug || '';
          const createdId = createdMediaMap.get(key);
          return {
            id: createdId || key,
            title: r.title,
            slug: r.slug,
            type: r.type,
            posterUrl: r.posterUrl,
            year: r.year,
            rating: r.rating,
            synopsis: r.synopsis,
            inDb: !!createdId,
            linksCount: 0,
          };
        }),
      ];

      releaseSearchLock(c, ip);
      return c.json({ success: true, query: q, data: results, queuedJobs, dispatchedJobs });
    } catch (error: any) {
      releaseSearchLock(c, ip);
      console.error('Erreur recherche avancee:', error.message);
      return c.json({ success: false, error: 'Erreur lors de la recherche avancee' }, 500);
    }
  }
);

// ========== GET /api/search/status/:jobId ==========
searchRoutes.get('/status/:jobId', async (c) => {
  const { jobId } = c.req.param();
  try {
    const entry = await c.env.KV.get(`ga_dispatch:${jobId}`);
    if (!entry) return c.json({ success: false, error: 'Job not found' }, 404);
    const data = JSON.parse(entry);
    return c.json({ success: true, jobId, ...data });
  } catch (error: any) {
    console.error('Erreur status job:', error.message);
    return c.json({ success: false, error: 'Erreur' }, 500);
  }
});

export default searchRoutes;
