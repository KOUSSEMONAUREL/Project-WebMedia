import { scrapeMedia, MediaTarget } from './pipeline';
import type { BaseScraper } from '../engine/base';
import { createLog } from './log.js';

const INTERNAL_API_URL = process.env.INTERNAL_API_URL || 'http://localhost:8787/api/internal';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

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
    timeout: 30000,
  });
}

export async function processMedia(media: MediaTarget): Promise<{ chaptersSaved: number; sourcesMatched: number }> {
  const { results, sourcesMatched } = await scrapeMedia(media);
  let chaptersSaved = 0;

  for (const result of results) {
    if (!result.rootUrl) continue;

    if (media.type === 'comic' && result.chapters.length > 0) {
      for (const chapter of result.chapters) {
        let playerHost = result.source;
        try { playerHost = new URL(chapter.url).hostname; } catch { /* relative url */ }

        try {
          await callInternal('/ingest/liens', {
            mediaId: result.mediaId,
            links: [{
              source_site: result.source,
              player_host: playerHost,
              url: chapter.url,
              qualite: 'comic',
              langue: 'EN',
            }],
          });
          chaptersSaved += 1;
        } catch (err: any) {
          console.error(`    ✗ Failed to save: ${err.message}`);
        }
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

      try {
        await callInternal('/ingest/liens', {
          mediaId: result.mediaId,
          links: [{
            source_site: result.source,
            player_host: playerHost,
            url: result.rootUrl,
            qualite: 'webtoon',
            langue: 'EN',
          }],
        });
        chaptersSaved += 1;
      } catch (err: any) {
        console.error(`    ✗ Failed to save: ${err.message}`);
      }
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
      const sb = postgres(supabaseUrl, { prepare: false });
      const neon = postgres(neonUrl, { prepare: false });

      const log = createLog('Webtoon Scraper', 'queue');
      log.header();

      let processed = 0;
      let errors = 0;
      const maxJobs = 60;

      /**
       * Nombre d'essais avant de declarer un media non scrappable. Aligne sur
       * scrapling-worker (src/main.py) qui utilise 2, et sur le seuil historique
       * des workers TS. Au-dela, on ne repete plus : soit le titre n'existe nulle
       * part (-> no_match), soit la source est durablement en panne (-> failed).
       */
      const MAX_ATTEMPTS = 3;

      while (processed < maxJobs) {
        const [job] = await sb`
          UPDATE scraping_jobs
          SET status = 'processing', locked_at = NOW(), attempts = attempts + 1
          WHERE id = (
            SELECT id FROM scraping_jobs
            WHERE status = 'pending' AND worker_type = 'webtoon'
              AND media_type IN ('webtoon', 'comic', 'manga')
            ORDER BY priority DESC, created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          )
          RETURNING id, media_id, media_type, title, slug, attempts
        `;

        if (!job) break;

        const [media] = await neon`
          SELECT id, title, slug, type, external_id, metadata_source, synopsis
          FROM medias WHERE id = ${job.media_id}
        `;
        if (!media) {
          errors++;
          await sb`UPDATE scraping_jobs SET status = 'failed', last_error = 'Media not found', updated_at = NOW() WHERE id = ${job.id}`;
          continue;
        }

        processed++;
        log.start(`Processing`, { title: media.title, type: media.type });

        const result = await processMedia({
          id: media.id, title: media.title, slug: media.slug,
          type: media.type, externalId: media.external_id,
          metadataSource: media.metadata_source, synopsis: media.synopsis,
        });

        if (result.chaptersSaved > 0) {
          await sb`UPDATE scraping_jobs SET status = 'completed', updated_at = NOW() WHERE id = ${job.id}`;
          log.success(`Saved ${result.chaptersSaved} link(s)`);
        } else if (result.sourcesMatched === 0) {
          // Aucun des scrapers ne porte ce titre. Distinct de `failed` : le job a
          // bien ete traite, le media n'est simplement pas dans les sources, ou
          // pas sous ce nom. Sans cette branche, `no_match` ne serait jamais pose
          // pour le webtoon alors que l'orchestrateur le sait deja lire
          // (isPermanentFailure), et le media repartirait en boucle indefiniment :
          // chaque cycle recreait la ligne avec attempts=0 et repartait de zero.
          if (job.attempts >= MAX_ATTEMPTS) {
            await sb`UPDATE scraping_jobs SET status = 'no_match', last_error = 'No webtoon source carries this title', updated_at = NOW() WHERE id = ${job.id}`;
            log.error(`no_match after ${job.attempts} attempts (aucune source)`);
          } else {
            await sb`UPDATE scraping_jobs SET status = 'pending', updated_at = NOW() WHERE id = ${job.id}`;
            log.retry('No source matched', job.attempts, MAX_ATTEMPTS);
          }
        } else {
          // Au moins une source a ete trouvee : le titre existe, c'est le scrape
          // qui a echoue (source en panne, 403, timeout). C'est transitoire, donc
          // le message doit le dire pour que le regex de l'orchestrateur le
          // classe en erreur de pile et non en disparition de la source.
          if (job.attempts >= MAX_ATTEMPTS) {
            await sb`UPDATE scraping_jobs SET status = 'failed', last_error = ${`No chapters on ${result.sourcesMatched} matched source(s)`}, updated_at = NOW() WHERE id = ${job.id}`;
            log.error(`Failed after ${job.attempts} attempts`);
          } else {
            await sb`UPDATE scraping_jobs SET status = 'pending', updated_at = NOW() WHERE id = ${job.id}`;
            log.retry('No chapters', job.attempts, MAX_ATTEMPTS);
          }
        }
      }

      log.summary(processed, errors);
      await sb.end();
      await neon.end();
      process.exit(0);
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
