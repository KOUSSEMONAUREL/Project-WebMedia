import axios from 'axios';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';

const INTERNAL_API_URL = process.env.INTERNAL_API_URL || 'http://localhost:8787/api/internal';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';
const NEON_URL = process.env.NEON_DATABASE_URL || '';
const SUPABASE_URL = process.env.SUPABASE_DATABASE_URL || '';

if (!NEON_URL) console.error('⚠️ NEON_DATABASE_URL non défini');
if (!SUPABASE_URL) console.error('⚠️ SUPABASE_DATABASE_URL non défini');

// Neon client pour lire les infos media
const neonSql = postgres(NEON_URL, { prepare: false });
const neonDb = drizzle(neonSql);

// Supabase client pour la queue
const supabaseSql = postgres(SUPABASE_URL, { prepare: false });
const sb = drizzle(supabaseSql);

// ========== SOURCES STREAMING (films/séries/anime) ==========
const STREAMING_SOURCES: { name: string; buildUrl: (id: number, type: string) => string; host: string }[] = [
  { name: 'vidsrc.me',   host: 'vidsrc.me',   buildUrl: (id, t) => `https://vidsrc.me/embed/${t === 'film' ? 'movie' : 'tv'}?tmdb=${id}` },
  { name: 'vidsrc.to',   host: 'vidsrc.to',   buildUrl: (id, t) => `https://vidsrc.to/embed/${t === 'film' ? 'movie' : 'tv'}/${id}` },
  { name: 'vidsrc.icu',  host: 'vidsrc.icu',  buildUrl: (id, t) => `https://vidsrc.icu/embed/${t === 'film' ? 'movie' : 'tv'}/${id}` },
  { name: '2embed.cc',   host: '2embed.cc',   buildUrl: (id, t) => `https://www.2embed.cc/embed/${t === 'film' ? 'movie' : 'tv'}/${id}` },
  { name: 'embed.su',    host: 'embed.su',    buildUrl: (id, t) => `https://embed.su/embed/${t === 'film' ? 'movie' : 'tv'}/${id}` },
  { name: 'multiembed',  host: 'multiembed.mov', buildUrl: (id, t) => `https://multiembed.mov/?video_id=${id}&tmdb=1` },
];

async function checkStream(url: string): Promise<boolean> {
  try {
    const res = await axios.head(url, { timeout: 5000, validateStatus: () => true });
    return res.status === 200 || res.status === 302;
  } catch (err) {
    console.error(`checkStream failed for ${url}: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

async function handleStreaming(mediaId: string, type: string, tmdbId?: number | null): Promise<number> {
  if (!tmdbId) {
    // Chercher dans Neon
    const [media] = await neonSql`SELECT tmdb_id FROM medias WHERE id = ${mediaId}`;
    tmdbId = media?.tmdb_id;
  }
  if (!tmdbId) return 0;

  const links: any[] = [];
  const mediaType = type === 'anime' ? 'serie' : type; // anime → TV embed

  for (const src of STREAMING_SOURCES) {
    try {
      const url = src.buildUrl(tmdbId, mediaType);
      if (await checkStream(url)) {
        links.push({ source_site: src.name, player_host: src.host, url, qualite: 'auto', langue: 'VFF/VOSTFR' });
      }
    } catch (err) {
      console.error(`Error checking stream source ${src.name}: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (links.length === 0) return 0;

  await axios.post(`${INTERNAL_API_URL}/ingest/liens`, { mediaId, links }, {
    headers: { 'X-Internal-API-Key': INTERNAL_API_KEY }, timeout: 15000,
  });
  return links.length;
}

async function handleWebtoon(mediaId: string, title: string, metadataSource?: string | null): Promise<number> {
  try {
    const { processMedia } = await import('../../webtoons/src/worker');
    const result = await processMedia({ id: mediaId, title, slug: '', type: 'webtoon', metadataSource: metadataSource || undefined });
    return result.chaptersSaved;
  } catch (err: any) {
    console.error(`  ❌ Webtoon pipeline error: ${err.message}`);
    return 0;
  }
}

// ========== BOUCLE PRINCIPALE ==========
export async function startWorker() {
  console.log('🚀 Cheerio Worker démarré');

  while (true) {
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

      if (!job) {
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      const { id: jobId, media_id: mediaId, media_type: mediaType, title, slug, attempts } = job;
      console.log(`\n🎯 [${mediaType}] ${title} (${mediaId})`);

      // Récupérer les infos du media depuis Neon
      const [media] = await neonSql`
        SELECT tmdb_id, anilist_id, metadata_source
        FROM medias WHERE id = ${mediaId}
      `;

      let savedLinks = 0;

      if (['webtoon', 'comic', 'manga'].includes(mediaType)) {
        savedLinks = await handleWebtoon(mediaId, title, media?.metadata_source);
      } else if (['film', 'serie', 'anime'].includes(mediaType)) {
        savedLinks = await handleStreaming(mediaId, mediaType, media?.tmdb_id);
      } else if (mediaType === 'book') {
        console.log('  ℹ️ Book: liens déjà sauvegardés pendant l\'import');
        savedLinks = 1;
      } else {
        console.log(`  ⏭️ Type non géré: ${mediaType}`);
      }

      if (savedLinks > 0) {
        await supabaseSql`UPDATE scraping_jobs SET status = 'completed', updated_at = NOW() WHERE id = ${jobId}`;
        console.log(`  ✅ ${savedLinks} lien(s) sauvé(s)`);
      } else {
        if (attempts >= 3) {
          await supabaseSql`UPDATE scraping_jobs SET status = 'failed', last_error = 'No links found', updated_at = NOW() WHERE id = ${jobId}`;
          console.log(`  ❌ Échec (${attempts}/3 tentatives)`);
        } else {
          await supabaseSql`UPDATE scraping_jobs SET status = 'pending', updated_at = NOW() WHERE id = ${jobId}`;
          console.log(`  ⏳ Nouvelle tentative (${attempts}/3)`);
        }
      }

    } catch (err: any) {
      console.error('💥 Erreur worker:', err.message);
      if (err.message?.includes('password authentication')) {
        console.error('   → Vérifie SUPABASE_DATABASE_URL dans les secrets GitHub (doit être l\'URL du pooler :6543, pas la directe :5432)');
        break;
      }
    }
  }
}

if (process.argv[1]?.endsWith('index.ts')) {
  startWorker().catch(console.error);
}
