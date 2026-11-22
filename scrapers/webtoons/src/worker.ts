import { scrapeMedia, MediaTarget } from './pipeline';
import type { BaseScraper } from '../engine/base';
import { createLog } from './log.js';

const INTERNAL_API_URL = process.env.INTERNAL_API_URL || 'http://localhost:8787/api/internal';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';
const INGEST_BATCH_SIZE = 500;
const INGEST_TIMEOUT_MS = 60_000;
const RUN_BUDGET_MS = 90 * 60 * 1000;
const MAX_LINKS_PER_RUN = 20_000;

// URLs génériques/polluées (pages de recherche, racines) à ne pas enregistrer
const BLOCKED_URL_PATTERNS = [
  /\/search/i,
  /\?s=/i,
  /updates-list/i,
  /\/reader\/en\/?$/i,
  /\/chapters\/?$/i,
  /\?category=/i,
];

function isGenericUrl(url: string): boolean {
  if (!url) return true;
  try {
    const u = new URL(url);
    if (u.pathname === '/' || u.pathname === '') return true;
    return BLOCKED_URL_PATTERNS.some(p => p.test(u.pathname + u.search));
  } catch {
    // URL relative (ex: /en/comic/... de ComicK) : légitime, pas une page
    // générique. On évalue quand même les patterns sur le chemin brut.
    return BLOCKED_URL_PATTERNS.some(p => p.test(url));
  }
}

async function callInternal(endpoint: string, data: unknown) {
  const axios = (await import('axios')).default;
  return axios.post(`${INTERNAL_API_URL}${endpoint}`, data, {
    headers: { 'X-Internal-API-Key': INTERNAL_API_KEY },
    timeout: INGEST_TIMEOUT_MS,
  });
}

const DB_RETRYABLE = new Set([
  'CONNECTION_CLOSED', 'CONNECTION_DESTROYED', 'CONNECTION_ENDED',
  'CONNECT_TIMEOUT', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', '57P01', '08006',
]);

async function withDbRetry<T>(label: string, run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (err: any) {
      const code = String(err?.code || err?.errno || '');
      if (attempt >= 3 || !DB_RETRYABLE.has(code)) throw err;
      const delay = 250 * 2 ** (attempt - 1);
      console.warn(`  DB ${label}: ${code}, retry ${attempt}/3 in ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

interface IngestLink {
  source_site: string;
  player_host: string;
  url: string;
  qualite: string;
  langue: string;
}

function errorDetail(err: any, links: IngestLink[]): string {
  const status = err?.response?.status;
  const data = err?.response?.data;
  let body = '';
  if (data !== undefined) {
    try {
      body = typeof data === 'string' ? data : JSON.stringify(data);
    } catch {
      body = String(data);
    }
    body = body.slice(0, 500);
  }
  let bytes = 0;
  try {
    bytes = Buffer.byteLength(JSON.stringify({ links }));
  } catch {
    // Taille indicative seulement.
  }
  return `batch=${links.length} bytes=${bytes}${status ? ` status=${status}` : ''}${body ? ` body=${body}` : ''}`;
}

/**
 * Envoie un lot et scinde en deux sur 413. Un 413 observe sur un lot de 170
 * alors que des lots de 500 passaient : c'est intermittent (proxy/WARP), donc
 * la scission est plus sure qu'une reduction globale de la taille des lots.
 *
 * La profondeur et la taille minimale bornent le nombre de requetes si le 413
 * est permanent, pour ne pas transformer un incident proxy en tempete d'appels.
 */
const MAX_SPLIT_DEPTH = 6;
const MIN_SPLIT_SIZE = 10;

async function saveLinkBatch(mediaId: string, links: IngestLink[], depth = 0): Promise<number> {
  try {
    await callInternal('/ingest/liens', { mediaId, links });
    return links.length;
  } catch (err: any) {
    const status = err?.response?.status;
    if (status === 413 && links.length > MIN_SPLIT_SIZE && depth < MAX_SPLIT_DEPTH) {
      const mid = Math.ceil(links.length / 2);
      console.warn(
        `    ↻ Batch of ${links.length} rejected with 413, splitting ${mid} + ${links.length - mid} (depth ${depth + 1})`
      );
      const left = await saveLinkBatch(mediaId, links.slice(0, mid), depth + 1);
      const right = await saveLinkBatch(mediaId, links.slice(mid), depth + 1);
      return left + right;
    }
    console.error(`    ✗ Failed to save ${errorDetail(err, links)}: ${err?.message || err}`);
    if (links.length === 1) {
      console.error(`      URL: ${links[0]?.url}`);
    }
    return 0;
  }
}

export async function processMedia(media: MediaTarget): Promise<{ chaptersSaved: number; sourcesMatched: number }> {
  const { results, sourcesMatched } = await scrapeMedia(media);
  let chaptersSaved = 0;

  for (const result of results) {
    if (!result.rootUrl) continue;

    if (media.type === 'comic' && result.chapters.length > 0) {
      const seen = new Set<string>();
      const links: IngestLink[] = result.chapters
        .filter(chapter => {
          if (seen.has(chapter.url)) return false;
          seen.add(chapter.url);
          return true;
        })
        .map(chapter => {
          let playerHost = result.source;
          try { playerHost = new URL(chapter.url).hostname; } catch { /* relative url */ }
          return {
            source_site: result.source,
            player_host: playerHost,
            url: chapter.url,
            qualite: 'comic',
            langue: 'EN',
          };
        });

      for (const batch of chunk(links, INGEST_BATCH_SIZE)) {
        chaptersSaved += await saveLinkBatch(result.mediaId, batch);
      }
    } else {
      // Webtoon/manga: un seul rootUrl. On S'EFFACE si aucun chapitre n'a été
      // trouvé ET que l'URL ressemble à une page générique (search/home), pour
      // ne pas re-injecter les URLs polluées (searchadvance, /chapters, reader/en).
      if (result.chapters.length === 0 && isGenericUrl(result.rootUrl)) {
        console.warn(`    Skip generic rootUrl (${result.source}): ${result.rootUrl}`);
        continue;
      }

      let playerHost = result.source;
      try { playerHost = new URL(result.rootUrl).hostname; } catch { /* relative url */ }

      chaptersSaved += await saveLinkBatch(result.mediaId, [{
        source_site: result.source,
        player_host: playerHost,
        url: result.rootUrl,
        qualite: 'webtoon',
        langue: 'EN',
      }]);
    }
  }

  return { chaptersSaved, sourcesMatched };
}

if (process.argv[1]?.endsWith('worker.ts')) {
  const mode = process.argv[2];

  if (mode === '--title') {
    const title = process.argv[3];
    const type = process.argv[4] === '--type' ? process.argv[5] || 'webtoon' : 'webtoon';
    if (!title) {
      console.error('Usage: npx tsx src/worker.ts --title <title> [--type webtoon|comic]');
      process.exit(1);
    }
    console.log(`[DIRECT] Searching sources for: ${title} (type: ${type})`);
    import('postgres').then(async ({ default: postgres }) => {
      const result = await processMedia({
        id: '0', title, slug: title.toLowerCase().replace(/\s+/g, '-'),
        type, externalId: null,
        metadataSource: null, synopsis: null,
      } as any);
      console.log(`[DIRECT] Found ${result.chaptersSaved} link(s) for '${title}'`);
      process.exit(0);
    });
  } else if (mode === '--queue') {
    import('postgres').then(async ({ default: postgres }) => {
      const supabaseUrl = process.env.SUPABASE_DATABASE_URL || '';
      const neonUrl = process.env.NEON_DATABASE_URL || '';
      if (!supabaseUrl || !neonUrl) {
        console.error('Missing SUPABASE_DATABASE_URL or NEON_DATABASE_URL');
        process.exit(1);
      }
      const dbOptions = {
        prepare: false,
        max: 2,
        idle_timeout: 20,
        max_lifetime: 300,
        connect_timeout: 10,
        keep_alive: 30,
      };
      const sb = postgres(supabaseUrl, dbOptions);
      const neon = postgres(neonUrl, dbOptions);

      const log = createLog('Webtoon Scraper', 'queue');
      log.header();

      let processed = 0;
      let errors = 0;
      let linksSaved = 0;
      let deferredRetries = 0;
      const maxJobs = 60;
      const deadline = Date.now() + RUN_BUDGET_MS;

      // Les jobs liberes pour retry restent `pending`. Sans cette exclusion, la
      // boucle les reclamait immediatement et repayait 30 s de recherche dans le
      // meme run. Ils seront repris au prochain run planifie.
      const skippedJobIds = new Set<string>();

      /**
       * Nombre d'essais avant de declarer un media non scrappable. Aligne sur
       * scrapling-worker (src/main.py) qui utilise 2, et sur le seuil historique
       * des workers TS. Au-dela, on ne repete plus : soit le titre n'existe nulle
       * part (-> no_match), soit la source est durablement en panne (-> failed).
       */
      const MAX_ATTEMPTS = 3;

      let currentJobId: string | null = null;
      try {
        while (processed < maxJobs && linksSaved < MAX_LINKS_PER_RUN) {
          if (Date.now() >= deadline) {
            log.warn(`Run budget reached (${Math.round(RUN_BUDGET_MS / 60000)} min), stopping queue worker`);
            break;
          }

          const [job] = await withDbRetry('claim job', () => sb`
            UPDATE scraping_jobs
            SET status = 'processing', locked_at = NOW(), attempts = attempts + 1
            WHERE id = (
              SELECT id FROM scraping_jobs
              WHERE status = 'pending' AND worker_type = 'webtoon'
                AND media_type IN ('webtoon', 'comic', 'manga')
                AND id <> ALL(${[...skippedJobIds]}::uuid[])
              ORDER BY priority DESC, created_at ASC
              LIMIT 1
              FOR UPDATE SKIP LOCKED
            )
            RETURNING id, media_id, media_type, title, slug, attempts
          `);

          if (!job) {
            if (skippedJobIds.size > 0) {
              log.info(`No more claimable jobs; ${skippedJobIds.size} deferred to next run`);
            }
            break;
          }
          currentJobId = job.id;

          const [media] = await withDbRetry('load media', () => neon`
            SELECT id, title, slug, type, external_id, metadata_source, synopsis
            FROM medias WHERE id = ${job.media_id}
          `);
          if (!media) {
            errors++;
            await withDbRetry('mark media missing', () => sb`UPDATE scraping_jobs SET status = 'failed', last_error = 'Media not found', updated_at = NOW() WHERE id = ${job.id}`);
            currentJobId = null;
            continue;
          }

          processed++;
          log.start(`Processing`, { title: media.title, type: media.type });

          const result = await processMedia({
            id: media.id, title: media.title, slug: media.slug,
            type: media.type, externalId: media.external_id,
            metadataSource: media.metadata_source, synopsis: media.synopsis,
          });
          linksSaved += result.chaptersSaved;

          if (result.chaptersSaved > 0) {
            await withDbRetry('mark completed', () => sb`UPDATE scraping_jobs SET status = 'completed', updated_at = NOW() WHERE id = ${job.id}`);
            currentJobId = null;
            log.success(`Saved ${result.chaptersSaved} link(s)`);
          } else if (result.sourcesMatched === 0) {
            // Aucun des scrapers ne porte ce titre. Distinct de `failed` : le job a
            // bien ete traite, le media n'est simplement pas dans les sources, ou
            // pas sous ce nom. Sans cette branche, `no_match` ne serait jamais pose
            // pour le webtoon alors que l'orchestrateur le sait deja lire
            // (isPermanentFailure), et le media repartirait en boucle indefiniment :
            // chaque cycle recreait la ligne avec attempts=0 et repartait de zero.
            if (job.attempts >= MAX_ATTEMPTS) {
              await withDbRetry('mark no_match', () => sb`UPDATE scraping_jobs SET status = 'no_match', last_error = 'No webtoon source carries this title', updated_at = NOW() WHERE id = ${job.id}`);
              currentJobId = null;
              log.error(`no_match after ${job.attempts} attempts (aucune source)`);
            } else {
              await withDbRetry('release no_match job', () => sb`UPDATE scraping_jobs SET status = 'pending', locked_at = NULL, updated_at = NOW() WHERE id = ${job.id}`);
              skippedJobIds.add(job.id);
              deferredRetries++;
              currentJobId = null;
              log.retry('No source matched (retry differe)', job.attempts, MAX_ATTEMPTS);
            }
          } else {
            // Au moins une source a ete trouvee : le titre existe, c'est le scrape
            // qui a echoue (source en panne, 403, timeout). C'est transitoire, donc
            // le message doit le dire pour que le regex de l'orchestrateur le
            // classe en erreur de pile et non en disparition de la source.
            if (job.attempts >= MAX_ATTEMPTS) {
              await withDbRetry('mark failed', () => sb`UPDATE scraping_jobs SET status = 'failed', last_error = ${`No chapters on ${result.sourcesMatched} matched source(s)`}, updated_at = NOW() WHERE id = ${job.id}`);
              currentJobId = null;
              log.error(`Failed after ${job.attempts} attempts`);
            } else {
              await withDbRetry('release retry job', () => sb`UPDATE scraping_jobs SET status = 'pending', locked_at = NULL, updated_at = NOW() WHERE id = ${job.id}`);
              skippedJobIds.add(job.id);
              deferredRetries++;
              currentJobId = null;
              log.retry('No chapters (retry differe)', job.attempts, MAX_ATTEMPTS);
            }
          }
        }

        log.summary(processed, errors);
        log.info(`Links saved: ${linksSaved}`);
        log.info(`Retries deferred to next run: ${deferredRetries}`);
        process.exitCode = 0;
      } catch (err: any) {
        const detail = `${err?.code || ''} ${err?.message || err}`.trim();
        console.error(`Queue worker failed: ${detail}`);
        if (currentJobId) {
          try {
            await withDbRetry('requeue job', () => sb`UPDATE scraping_jobs SET status = 'pending', locked_at = NULL, updated_at = NOW() WHERE id = ${currentJobId}`);
          } catch (requeueErr: any) {
            console.error(`Could not requeue job ${currentJobId}: ${requeueErr?.message || requeueErr}`);
          }
        }
        process.exitCode = 1;
      } finally {
        await sb.end().catch(() => {});
        await neon.end().catch(() => {});
      }
      process.exit(process.exitCode === 1 ? 1 : 0);
    });
  } else {
    const mediaId = mode;
    if (!mediaId) {
      console.error('Usage: npx tsx src/worker.ts <media-id>');
      console.error('       npx tsx src/worker.ts --queue');
      process.exit(1);
    }
    import('postgres').then(async ({ default: postgres }) => {
      const sql = postgres(process.env.NEON_DATABASE_URL || '');
      const [media] = await sql`SELECT id, title, slug, type, external_id, metadata_source, synopsis FROM medias WHERE id = ${mediaId}`;
      if (!media) {
        console.error(`Media ${mediaId} not found`);
        process.exit(1);
      }
      await processMedia({
        id: media.id,
        title: media.title,
        slug: media.slug,
        type: media.type,
        externalId: media.external_id,
        metadataSource: media.metadata_source,
        synopsis: media.synopsis,
      });
      process.exit(0);
    });
  }
}
