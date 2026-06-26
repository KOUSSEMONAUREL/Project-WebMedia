import { scrapeMedia, MediaTarget } from './pipeline';
import type { BaseScraper } from '../engine/base';

const INTERNAL_API_URL = process.env.INTERNAL_API_URL || 'http://localhost:8787/api/internal';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

async function callInternal(endpoint: string, data: unknown) {
  const axios = (await import('axios')).default;
  return axios.post(`${INTERNAL_API_URL}${endpoint}`, data, {
    headers: { 'X-Internal-API-Key': INTERNAL_API_KEY },
    timeout: 30000,
  });
}

export async function processMedia(media: MediaTarget): Promise<{ chaptersSaved: number }> {
  console.log(`\n🎯 Processing: ${media.title} (${media.id})`);
  const results = await scrapeMedia(media);
  let chaptersSaved = 0;

  for (const result of results) {
    if (result.chapters.length === 0) continue;

    console.log(`  📚 ${result.source}: ${result.chapters.length} chapters`);

    // Sauvegarder les chapitres comme liens
    const links = result.chapters.map((ch, i) => ({
      source_site: result.source,
      player_host: new URL(ch.url).hostname,
      url: ch.url,
      qualite: 'webtoon',
      langue: 'EN',
      titre: ch.name,
      numero: ch.chapterNumber ?? i + 1,
    }));

    try {
      await callInternal('/ingest/liens', {
        mediaId: result.mediaId,
        links,
      });
      chaptersSaved += links.length;
    } catch (err: any) {
      console.error(`    ❌ Failed to save: ${err.message}`);
    }
  }

  return { chaptersSaved };
}

// Mode CLI : exécution directe ou via queue
if (process.argv[1]?.endsWith('worker.ts')) {
  const mode = process.argv[2];

  if (mode === '--queue') {
    // Mode queue : puller les jobs webtoon depuis Supabase
    import('postgres').then(async ({ default: postgres }) => {
      const supabaseUrl = process.env.SUPABASE_DATABASE_URL || '';
      const neonUrl = process.env.NEON_DATABASE_URL || '';
      if (!supabaseUrl || !neonUrl) {
        console.error('Missing SUPABASE_DATABASE_URL or NEON_DATABASE_URL');
        process.exit(1);
      }
      const sb = postgres(supabaseUrl, { prepare: false });
      const neon = postgres(neonUrl, { prepare: false });

      let processed = 0;
      const maxJobs = 10;

      while (processed < maxJobs) {
        const [job] = await sb`
          UPDATE scraping_jobs
          SET status = 'processing', locked_at = NOW(), attempts = attempts + 1
          WHERE id = (
            SELECT id FROM scraping_jobs
            WHERE status = 'pending' AND worker_type = 'cheerio'
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
          await sb`UPDATE scraping_jobs SET status = 'failed', last_error = 'Media not found', updated_at = NOW() WHERE id = ${job.id}`;
          continue;
        }

        console.log(`\n🎯 [${processed + 1}/${maxJobs}] ${media.title}`);
        const result = await processMedia({
          id: media.id, title: media.title, slug: media.slug,
          type: media.type, externalId: media.external_id,
          metadataSource: media.metadata_source, synopsis: media.synopsis,
        });

        if (result.chaptersSaved > 0) {
          await sb`UPDATE scraping_jobs SET status = 'completed', updated_at = NOW() WHERE id = ${job.id}`;
          console.log(`  ✅ ${result.chaptersSaved} chapters`);
        } else {
          if (job.attempts >= 3) {
            await sb`UPDATE scraping_jobs SET status = 'failed', last_error = 'No chapters found', updated_at = NOW() WHERE id = ${job.id}`;
          } else {
            await sb`UPDATE scraping_jobs SET status = 'pending', updated_at = NOW() WHERE id = ${job.id}`;
          }
        }
        processed++;
      }

      await sb.end();
      await neon.end();
      console.log(`\n🏁 Processed ${processed} webtoon jobs.`);
      process.exit(0);
    });
  } else {
    // Mode direct : media ID en argument
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
