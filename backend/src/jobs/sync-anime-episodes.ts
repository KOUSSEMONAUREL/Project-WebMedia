import 'dotenv/config';
import { getNeonClient } from '../db/singleton';
import { medias, episodes } from '../db/neon/schema';
import { eq, and, isNotNull, inArray, sql } from 'drizzle-orm';
import { createClient } from '@libsql/client';

const TMDB_ACCESS_TOKEN = process.env.TMDB_ACCESS_TOKEN || '';
const FRIBB_URL = 'https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json';
const TURSO_URL = process.env.TURSO_DATABASE_URL || '';
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || '';
const FORCE = process.env.FORCE === 'true';

type FribbEntry = {
  anilist_id?: number | string;
  themoviedb_id?: number | { tv?: number; movie?: number };
  season?: { tmdb?: number; tvdb?: number };
  episode_offset?: { tmdb?: number; tvdb?: number };
};

async function fetchFribbData(): Promise<Map<string, { tmdbId: number; season: number; offset: number }>> {
  const res = await fetch(FRIBB_URL);
  if (!res.ok) throw new Error(`Fribb fetch failed: ${res.status}`);
  const data = await res.json() as FribbEntry[];
  const map = new Map<string, { tmdbId: number; season: number; offset: number }>();

  for (const entry of data) {
    if (!entry.anilist_id) continue;
    let tmdbId: number | null = null;
    if (typeof entry.themoviedb_id === 'number') {
      tmdbId = entry.themoviedb_id;
    } else if (entry.themoviedb_id) {
      tmdbId = entry.themoviedb_id.tv ?? entry.themoviedb_id.movie ?? null;
    }
    if (!tmdbId) continue;

    const season = entry.season?.tmdb ?? 1;
    const offset = entry.episode_offset?.tmdb ?? 0;
    map.set(String(entry.anilist_id), { tmdbId, season, offset });
  }

  return map;
}

async function fetchTmdbSeason(tmdbId: number, seasonNumber: number, mediaId: string): Promise<any[]> {
  const url = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNumber}?language=en-US`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TMDB_ACCESS_TOKEN}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    if (res.status === 404) {
      // Fallback: some animes have their own TMDB entry (e.g. S3 = 492999, season=1)
      if (seasonNumber !== 1) {
        return fetchTmdbSeason(tmdbId, 1, mediaId);
      }
      return [];
    }
    console.warn(`  TMDB ${res.status} tv/${tmdbId}/season/${seasonNumber}, fallback season=1...`);
    if (seasonNumber !== 1) {
      return fetchTmdbSeason(tmdbId, 1, mediaId);
    }
    return [];
  }
  const data = await res.json() as any;
  return data.episodes ?? [];
}

async function syncToTurso(neonUrl: string, episodeIds: string[] = []) {
  if (!TURSO_URL || !TURSO_TOKEN) {
    console.log('Turso non configure, skipping sync');
    return;
  }
  if (episodeIds.length === 0) {
    console.log('  Aucun nouvel episode a sync vers Turso');
    return;
  }
  console.log(`\nSyncing ${episodeIds.length} new episodes Neon -> Turso...`);
  const { db: neonDb } = getNeonClient(neonUrl);
  const turso = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

  const animeEpisodes = await neonDb.select({
    id: episodes.id,
    mediaId: episodes.mediaId,
    seasonNumber: episodes.seasonNumber,
    episodeNumber: episodes.episodeNumber,
    title: episodes.title,
    synopsis: episodes.synopsis,
    airDate: episodes.airDate,
    thumbnailUrl: episodes.thumbnailUrl,
    duration: episodes.duration,
  })
    .from(episodes)
    .where(inArray(episodes.id, episodeIds));

  if (animeEpisodes.length === 0) {
    console.log('  Aucun episode anime a sync vers Turso');
    return;
  }

  const CHUNK = 200;
  let synced = 0;

  for (let i = 0; i < animeEpisodes.length; i += CHUNK) {
    const chunk = animeEpisodes.slice(i, i + CHUNK);
    const values: string[] = [];
    const args: any[] = [];

    for (const ep of chunk) {
      values.push(`(${[1,2,3,4,5,6,7,8,9].map(() => '?').join(',')})`);
      args.push(
        ep.id, ep.mediaId, ep.seasonNumber, ep.episodeNumber,
        ep.title ?? null, ep.synopsis ?? null,
        ep.airDate ? ep.airDate.toISOString() : null,
        ep.thumbnailUrl ?? null, ep.duration ?? null
      );
    }

    await turso.execute({
      sql: `INSERT INTO episodes (id, media_id, season_number, episode_number, title, synopsis, air_date, thumbnail_url, duration)
            VALUES ${values.join(',')}
            ON CONFLICT(id) DO UPDATE SET
              media_id = excluded.media_id,
              season_number = excluded.season_number,
              episode_number = excluded.episode_number,
              title = excluded.title,
              synopsis = excluded.synopsis,
              air_date = excluded.air_date,
              thumbnail_url = excluded.thumbnail_url,
              duration = excluded.duration`,
      args,
    });
    synced += chunk.length;
  }

  console.log(`  ${synced} episodes anime synced to Turso`);
  turso.close();
}

async function syncTmdbIdsToTurso(mediaTmdbMap: Map<string, number>) {
  if (!TURSO_URL || !TURSO_TOKEN) return;
  if (mediaTmdbMap.size === 0) return;

  const turso = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
  const missing: { id: string; tmdbId: number }[] = [];

  const ids = [...mediaTmdbMap.keys()];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const placeholders = chunk.map(() => '?').join(',');
    const result = await turso.execute({
      sql: `SELECT id FROM medias WHERE id IN (${placeholders}) AND tmdb_id IS NULL`,
      args: chunk,
    });
    for (const row of result.rows) {
      const mid = row.id as string;
      missing.push({ id: mid, tmdbId: mediaTmdbMap.get(mid)! });
    }
  }

  if (missing.length === 0) {
    turso.close();
    return;
  }

  for (const m of missing) {
    await turso.execute({
      sql: 'UPDATE medias SET tmdb_id = ? WHERE id = ?',
      args: [m.tmdbId, m.id],
    });
  }

  console.log(`  ${missing.length} tmdb_id synced to Turso`);
  turso.close();
}

async function main() {
  console.log('=== Sync Anime Episodes ===\n');

  const neonUrl = process.env.NEON_DATABASE_URL || '';
  if (!neonUrl) throw new Error('NEON_DATABASE_URL missing');

  const { db, client: pgClient } = getNeonClient(neonUrl);

  console.log('Fetching Fribb mapping...');
  const fribbMap = await fetchFribbData();
  console.log(`Fribb: ${fribbMap.size} entries loaded\n`);

  const LIMIT = parseInt(process.env.LIMIT || '0', 10);

  const rows = await db.select({
    id: medias.id,
    anilistId: medias.anilistId,
    tmdbId: medias.tmdbId,
    title: medias.title,
    slug: medias.slug,
    episodeCount: medias.episodeCount,
  })
    .from(medias)
    .where(and(eq(medias.type, 'anime'), isNotNull(medias.anilistId)))
    .limit(LIMIT || undefined as any);

  console.log(`Found ${rows.length} animes in DB\n`);

  let created = 0;
  let skipped = 0;
  let errors = 0;
  let noFribb = 0;
  let noTmdb = 0;
  let alreadyExist = 0;
  const newEpisodeIds: string[] = [];
  const mediaTmdbMap = new Map<string, number>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const key = String(row.anilistId);
    const fribbEntry = fribbMap.get(key);

    if (!fribbEntry) { noFribb++; skipped++; continue; }

    const tmdbId = fribbEntry.tmdbId ?? row.tmdbId;
    if (!tmdbId) { noTmdb++; skipped++; continue; }
    mediaTmdbMap.set(row.id, tmdbId);

    try {
      const existingCount = await db.select({ count: sql<number>`COUNT(*)::int` })
        .from(episodes)
        .where(eq(episodes.mediaId, row.id))
        .then(r => Number(r[0]?.count ?? 0));

      if (!FORCE && existingCount > 0) { alreadyExist++; skipped++; continue; }
      if (FORCE && existingCount > 0) {
        await db.delete(episodes).where(eq(episodes.mediaId, row.id));
      }

      const tmdbEpisodes = await fetchTmdbSeason(tmdbId, fribbEntry.season, row.id);
      if (tmdbEpisodes.length === 0) { skipped++; continue; }

      const offset = fribbEntry.offset;
      const maxEpisodes = row.episodeCount ?? tmdbEpisodes.length;

      let filtered = tmdbEpisodes;
      if (offset > 0) filtered = filtered.filter((ep: any) => ep.episode_number > offset);
      if (filtered.length > maxEpisodes) filtered = filtered.slice(0, maxEpisodes);
      if (filtered.length === 0) { skipped++; continue; }

      const episodeRows = filtered.map((ep: any) => ({
        mediaId: row.id,
        seasonNumber: fribbEntry.season,
        episodeNumber: ep.episode_number,
        title: ep.name || null,
        synopsis: ep.overview || null,
        airDate: ep.air_date ? new Date(ep.air_date) : null,
        thumbnailUrl: ep.still_path ? `https://image.tmdb.org/t/p/w300${ep.still_path}` : null,
        duration: ep.runtime || null,
      }));

      const inserted = await db.insert(episodes).values(episodeRows).returning({ id: episodes.id });
      newEpisodeIds.push(...inserted.map(r => r.id));
      created += episodeRows.length;
      process.stdout.write(`[${i + 1}/${rows.length}] +${episodeRows.length} ${row.slug} (tmdb:${tmdbId} s${fribbEntry.season})\n`);
    } catch (err: any) {
      errors++;
      console.error(`[${i + 1}/${rows.length}] ERR ${row.slug}: ${err.message}`);
    }
  }

  console.log(`\n=== Resultats ===`);
  console.log(`Episodes crees:    ${created}`);
  console.log(`Deja existants:    ${alreadyExist}`);
  console.log(`Pas dans Fribb:    ${noFribb}`);
  console.log(`Pas de TMDB ID:    ${noTmdb}`);
  console.log(`Erreurs:           ${errors}`);
  console.log(`Total skipped:     ${skipped}`);

  if (created > 0) await syncToTurso(neonUrl, newEpisodeIds);
  await syncTmdbIdsToTurso(mediaTmdbMap);

  await pgClient.end();

  console.log('\nDone.');
  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
