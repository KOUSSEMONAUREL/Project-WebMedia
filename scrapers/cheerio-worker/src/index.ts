import axios from 'axios';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { createLog } from './log.js';

const INTERNAL_API_URL = process.env.INTERNAL_API_URL || 'http://localhost:8787/api/internal';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';
const NEON_URL = process.env.NEON_DATABASE_URL || '';
const SUPABASE_URL = process.env.SUPABASE_DATABASE_URL || '';

if (!NEON_URL) console.error('⚠️ NEON_DATABASE_URL non défini');
if (!SUPABASE_URL) console.error('⚠️ SUPABASE_DATABASE_URL non défini');

const neonSql = postgres(NEON_URL, { prepare: false });
const neonDb = drizzle(neonSql);

const supabaseSql = postgres(SUPABASE_URL, { prepare: false });
const sb = drizzle(supabaseSql);

// ========== SOURCES STREAMING ==========
type BuildUrlFn = (id: number, type: string, season?: number, episode?: number) => string;

const STREAMING_SOURCES: { name: string; buildUrl: BuildUrlFn; host: string }[] = [
  {
    name: 'vidsrc.me', host: 'vidsrc.me',
    buildUrl: (id, t, s, e) => t === 'film'
      ? `https://vidsrc.me/embed/movie?tmdb=${id}`
      : `https://vidsrc.me/embed/tv?tmdb=${id}&sea=${s ?? 1}&epi=${e ?? 1}`,
  },
  {
    name: 'vidsrc.to', host: 'vidsrc.to',
    buildUrl: (id, t, s, e) => t === 'film'
      ? `https://vidsrc.to/embed/movie/${id}`
      : `https://vidsrc.to/embed/tv/${id}/${s ?? 1}/${e ?? 1}`,
  },
  {
    name: 'vidsrc.icu', host: 'vidsrc.icu',
    buildUrl: (id, t, s, e) => t === 'film'
      ? `https://vidsrc.icu/embed/movie/${id}`
      : `https://vidsrc.icu/embed/tv/${id}/${s ?? 1}/${e ?? 1}`,
  },
  {
    name: '2embed.cc', host: '2embed.cc',
    buildUrl: (id, t, s, e) => t === 'film'
      ? `https://www.2embed.cc/embed/movie/${id}`
      : `https://www.2embed.cc/embed/tv/${id}/${s ?? 1}/${e ?? 1}`,
  },
  {
    name: 'embed.su', host: 'embed.su',
    buildUrl: (id, t, s, e) => t === 'film'
      ? `https://embed.su/embed/movie/${id}`
      : `https://embed.su/embed/tv/${id}/${s ?? 1}/${e ?? 1}`,
  },
  {
    name: 'multiembed', host: 'multiembed.mov',
    buildUrl: (id, t, s, e) => t === 'film'
      ? `https://multiembed.mov/?video_id=${id}&tmdb=1`
      : `https://multiembed.mov/?video_id=${id}&tmdb=1${s ? `&s=${s}` : ''}${e ? `&e=${e}` : ''}`,
  },
  {
    name: 'ezvidapi', host: 'ezvidapi.com',
    buildUrl: (id, t, s, e) => t === 'film'
      ? `https://ezvidapi.com/embed/movie/${id}`
      : `https://ezvidapi.com/embed/tv/${id}/${s ?? 1}/${e ?? 1}`,
  },
];

async function checkStream(url: string): Promise<boolean> {
  for (const method of ['head', 'get'] as const) {
    try {
      const res = await axios[method](url, { timeout: 5000, validateStatus: () => true });
      if (res.status === 200 || res.status === 302) return true;
      if (res.status === 405) continue;
      return false;
    } catch {
      continue;
    }
  }
  return false;
}

async function resolveTmdbId(mediaId: string, anilistId?: number | null): Promise<number | null> {
  if (anilistId) {
    try {
      const res = await axios.get(`${INTERNAL_API_URL}/resolve/tmdb?anilist_id=${anilistId}`, {
        headers: { 'X-Internal-API-Key': INTERNAL_API_KEY },
        timeout: 5000,
      });
      if (res.data?.success && res.data?.tmdb_id) return res.data.tmdb_id;
    } catch { /* not found */ }
  }
  try {
    const res = await axios.get(`${INTERNAL_API_URL}/resolve/tmdb?media_id=${mediaId}`, {
      headers: { 'X-Internal-API-Key': INTERNAL_API_KEY },
      timeout: 5000,
    });
    if (res.data?.success && res.data?.tmdb_id) return res.data.tmdb_id;
  } catch { /* not found */ }
  return null;
}

async function handleStreaming(mediaId: string, type: string, tmdbId?: number | null, anilistId?: number | null): Promise<number> {
  const [media] = await neonSql`SELECT id, tmdb_id, anilist_id FROM medias WHERE id = ${mediaId}`;
  if (!media) {
    return 0;
  }
  tmdbId = tmdbId ?? media.tmdb_id;
  anilistId = anilistId ?? media.anilist_id;

  if (!tmdbId) {
    tmdbId = await resolveTmdbId(mediaId, anilistId);
  }

  if (!tmdbId) return 0;

  const links: any[] = [];
  const isMovie = type === 'movie' || type === 'film';
  const isTv = type === 'serie' || type === 'anime';

  if (isMovie) {
    const results = await Promise.allSettled(
      STREAMING_SOURCES.map(async (src) => {
        const url = src.buildUrl(tmdbId, 'film');
        if (await checkStream(url)) {
          return { source_site: src.name, player_host: src.host, url, qualite: 'auto' };
        }
        return null;
      })
    );
    for (const r of results) if (r.status === 'fulfilled' && r.value) links.push(r.value);
  } else if (isTv) {
    const episodes = await neonSql`
      SELECT id, season_number, episode_number FROM episodes WHERE media_id = ${mediaId} ORDER BY season_number, episode_number
    `;

    if (episodes.length > 0) {
      const BATCH_SIZE = 10;
      for (let i = 0; i < episodes.length; i += BATCH_SIZE) {
        const batch = episodes.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.allSettled(
          batch.map(async (ep) => {
            const sourceResults = await Promise.allSettled(
              STREAMING_SOURCES.map(async (src) => {
                const url = src.buildUrl(tmdbId, 'serie', ep.season_number, ep.episode_number);
                if (await checkStream(url)) {
                  return { source_site: src.name, player_host: src.host, url, qualite: 'auto', episodeId: ep.id };
                }
                return null;
              })
            );
            return sourceResults;
          })
        );
        for (const batchResult of batchResults) {
          if (batchResult.status === 'fulfilled') {
            for (const r of batchResult.value) {
              if (r.status === 'fulfilled' && r.value) links.push(r.value);
            }
          }
        }
      }
    } else {
      const results = await Promise.allSettled(
        STREAMING_SOURCES.map(async (src) => {
          const url = src.buildUrl(tmdbId, 'serie', 1, 1);
          if (await checkStream(url)) {
            return { source_site: src.name, player_host: src.host, url, qualite: 'auto' };
          }
          return null;
        })
      );
      for (const r of results) if (r.status === 'fulfilled' && r.value) links.push(r.value);
    }
  }

  if (links.length === 0) return 0;

  try {
    await axios.post(`${INTERNAL_API_URL}/ingest/liens`, { mediaId, links }, {
      headers: { 'X-Internal-API-Key': INTERNAL_API_KEY }, timeout: 15000,
    });
  } catch (err: any) {
    return 0;
  }
  return links.length;
}

export async function startWorker() {
  const log = createLog('Cheerio Worker', 'one-shot');
  log.header();

  const MAX_JOBS = 10;
  let processed = 0;

  for (let i = 0; i < MAX_JOBS; i++) {
    try {
      const [job] = await supabaseSql`
        UPDATE scraping_jobs
        SET status = 'processing', locked_at = NOW(), attempts = attempts + 1
        WHERE id = (
          SELECT id FROM scraping_jobs
          WHERE status = 'pending' AND worker_type = 'cheerio'
          ORDER BY priority DESC, created_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, media_id, media_type, title, slug, attempts
      `;

      if (!job) break;

      const { id: jobId, media_id: mediaId, media_type: mediaType, title, slug, attempts } = job;
      log.start(`Processing`, { title, type: mediaType });

      let [media] = await neonSql`
        SELECT id, tmdb_id, anilist_id, metadata_source
        FROM medias WHERE id = ${mediaId}
      `;

      if (!media && slug) {
        [media] = await neonSql`
          SELECT id, tmdb_id, anilist_id, metadata_source
          FROM medias WHERE slug = ${slug}
        `;
      }

      if (!media) {
        log.warn(`Media not found in Neon: ${title}`);
        await supabaseSql`
          UPDATE scraping_jobs SET status = 'failed', last_error = 'Media not found in Neon'
          WHERE id = ${jobId}
        `;
        processed++;
        continue;
      }

      let savedLinks = 0;

      if (['film', 'movie', 'serie', 'anime'].includes(mediaType)) {
        savedLinks = await handleStreaming(media.id, mediaType, media.tmdb_id, media.anilist_id);
      } else {
        log.skip(`Delegated: ${mediaType}`);
        savedLinks = 1;
      }

      if (savedLinks > 0) {
        await supabaseSql`UPDATE scraping_jobs SET status = 'completed', updated_at = NOW() WHERE id = ${jobId}`;
        log.success(`Saved ${savedLinks} links`);
      } else {
        if (attempts >= 3) {
          await supabaseSql`UPDATE scraping_jobs SET status = 'failed', last_error = 'No links found', updated_at = NOW() WHERE id = ${jobId}`;
          log.error(`Failed after ${attempts} attempts`);
        } else {
          await supabaseSql`UPDATE scraping_jobs SET status = 'pending', updated_at = NOW() WHERE id = ${jobId}`;
          log.retry('Retrying', attempts, 3);
        }
      }

      processed++;

    } catch (err: any) {
      log.error(err.message);
      if (err.message?.includes('password authentication')) {
        log.warn('Check SUPABASE_DATABASE_URL secrets');
      }
    }
  }

  log.summary(processed, 0);
  process.exit(0);
}

if (process.argv[1]?.endsWith('index.ts')) {
  startWorker().catch(console.error);
}
