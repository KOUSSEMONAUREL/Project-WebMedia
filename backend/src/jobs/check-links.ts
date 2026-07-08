import 'dotenv/config';
import axios from 'axios';
import { createClient } from '@libsql/client';
import { drizzle as drizzleLibsql } from 'drizzle-orm/libsql';
import { getNeonClient } from '../db/singleton';
import { liens, medias, episodes } from '../db/neon/schema';
import { medias as tursoMedias, episodes as tursoEpisodes, liens as tursoLiens } from '../db/turso/schema';
import { eq, sql, and, inArray } from 'drizzle-orm';

async function mapConcurrent<T, R>(
    items: T[],
    fn: (item: T) => Promise<R>,
    concurrency: number
): Promise<R[]> {
    const results: R[] = [];
    for (let i = 0; i < items.length; i += concurrency) {
        const batch = items.slice(i, i + concurrency);
        const batchResults = await Promise.all(batch.map(fn));
        results.push(...batchResults);
    }
    return results;
}

async function checkLinks() {
    console.log("🔍 Starting Dead Link Checker (Batch Mode)...");

    const neonUrl = process.env.NEON_DATABASE_URL || '';
    if (!neonUrl) throw new Error("NEON_DATABASE_URL is missing");

    const { db, client: pgClient } = getNeonClient(neonUrl);

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);

    const linksToCheck = await db.select()
        .from(liens)
        .where(
            and(
                eq(liens.isActive, true),
                sql`${liens.lastVerified} < ${sevenDaysAgo.toISOString()} OR ${liens.lastVerified} IS NULL`
            )
        )
        .limit(100);

    console.log(`📡 Checking ${linksToCheck.length} links (concurrently)...`);

    const aliveIds: string[] = [];
    const deadFailCounts: { id: string; failCount: number; shouldDeactivate: boolean; mediaId: string }[] = [];

    await mapConcurrent(linksToCheck, async (link) => {
        try {
            const response = await axios.head(link.url, { timeout: 5000, validateStatus: () => true });
            if (response.status >= 200 && response.status < 400) {
                aliveIds.push(link.id);
            } else {
                const newFailCount = (link.failCount || 0) + 1;
                deadFailCounts.push({
                    id: link.id,
                    failCount: newFailCount,
                    shouldDeactivate: newFailCount >= 3,
                    mediaId: link.mediaId
                });
            }
        } catch (error) {
            deadFailCounts.push({
                id: link.id,
                failCount: (link.failCount || 0) + 1,
                shouldDeactivate: (link.failCount || 0) + 1 >= 3,
                mediaId: link.mediaId
            });
        }
    }, 10);

    // Batch UPDATEs en 2-3 appels au lieu de 200
    if (aliveIds.length > 0) {
        await db.update(liens)
            .set({ lastVerified: new Date(), failCount: 0 })
            .where(inArray(liens.id, aliveIds));
    }

    const toDeactivate = deadFailCounts.filter(d => d.shouldDeactivate);
    const justIncrement = deadFailCounts.filter(d => !d.shouldDeactivate);

    if (justIncrement.length > 0) {
        await db.update(liens)
            .set({ failCount: sql`fail_count + 1`, lastVerified: new Date() })
            .where(inArray(liens.id, justIncrement.map(d => d.id)));
    }

    if (toDeactivate.length > 0) {
        await db.update(liens)
            .set({ failCount: sql`fail_count + 1`, isActive: false, lastVerified: new Date() })
            .where(inArray(liens.id, toDeactivate.map(d => d.id)));

        // Batch decrement activeLinksCount for affected medias
        const mediaIds = [...new Set(toDeactivate.map(d => d.mediaId))];
        if (mediaIds.length > 0) {
            for (const mediaId of mediaIds) {
                const count = toDeactivate.filter(d => d.mediaId === mediaId).length;
                await db.update(medias)
                    .set({ activeLinksCount: sql`active_links_count - ${count}` })
                    .where(eq(medias.id, mediaId));
            }
        }
    }

    console.log(`✅ Done: ${aliveIds.length} alive, ${justIncrement.length} incremented, ${toDeactivate.length} deactivated.`);

    // Sync Neon -> Turso pour que le cache edge reflète les changements
    const tursoUrl = process.env.TURSO_DATABASE_URL || '';
    const tursoToken = process.env.TURSO_AUTH_TOKEN || '';
    if (tursoUrl && tursoToken) {
        console.log('🔄 Syncing Neon -> Turso...');
        await syncNeonToTurso(neonUrl, tursoUrl, tursoToken);
    }

    await pgClient.end();
}

async function syncNeonToTurso(neonUrl: string, tursoUrl: string, tursoToken: string) {
    const { db: neonDb } = getNeonClient(neonUrl);
    const tursoClient = createClient({ url: tursoUrl, authToken: tursoToken });
    const writer = drizzleLibsql(tursoClient, { schema: { medias: tursoMedias, episodes: tursoEpisodes, liens: tursoLiens } });

    type ColMap = Record<string, string>;
    const CHUNK = 200;

    async function batchUpsert(table: string, rows: any[], label: string) {
        if (rows.length === 0) return;
        const cols = Object.keys(rows[0]).filter(k => k !== 'id');
        const placeholders = cols.map(() => '?').join(',');
        const updates = cols.map(c => `"${c}" = excluded."${c}"`).join(',');
        const allCols = ['id', ...cols];

        for (let i = 0; i < rows.length; i += CHUNK) {
            const chunk = rows.slice(i, i + CHUNK);
            const values: any[] = [];
            const sqlParams: any[] = [];
            for (const row of chunk) {
                values.push(`(${allCols.map(() => '?').join(',')})`);
                for (const c of allCols) sqlParams.push((row as any)[c] ?? null);
            }
            await tursoClient.execute({
                sql: `INSERT INTO "${table}" (${allCols.map(c => `"${c}"`).join(',')}) VALUES ${values.join(',')} ON CONFLICT(id) DO UPDATE SET ${updates}`,
                args: sqlParams
            });
        }
        console.log(`  ${label}: ${rows.length} rows synced in ${Math.ceil(rows.length / CHUNK)} batches`);
    }

    console.log('Sync medias...');
    const allMedias = await neonDb.select().from(medias);
    await batchUpsert('medias', allMedias.map(m => ({
        id: m.id, external_id: m.externalId, type: m.type, title: m.title,
        original_title: m.originalTitle, slug: m.slug?.slice(0, 100), synopsis: m.synopsis,
        year: m.year, author: m.author, poster_url: m.posterUrl, backdrop_url: m.backdropUrl,
        rating: m.rating?.toString(), vote_count: m.voteCount, status: m.status,
        tmdb_id: m.tmdbId, imdb_id: m.imdbId, anilist_id: m.anilistId, mal_id: m.malId,
        kitsu_id: m.kitsuId, igdb_id: m.igdbId, anidb_id: m.anidbId, metadata_source: m.metadataSource,
        metadata_fresh_at: m.metadataFreshAt?.toISOString(), links_last_scraped_at: m.linksLastScrapedAt?.toISOString(),
        active_links_count: m.activeLinksCount, genres: m.genres, trailer_url: m.trailerUrl,
        tagline: m.tagline, studios: m.studios, episode_count: m.episodeCount,
        created_at: m.createdAt?.toISOString(), updated_at: new Date().toISOString()
    })), 'medias');

    console.log('Sync episodes...');
    const allEpisodes = await neonDb.select().from(episodes);
    await batchUpsert('episodes', allEpisodes.map(e => ({
        id: e.id, media_id: e.mediaId, season_number: e.seasonNumber,
        episode_number: e.episodeNumber, title: e.title, synopsis: e.synopsis,
        air_date: e.airDate?.toISOString(), thumbnail_url: e.thumbnailUrl, duration: e.duration
    })), 'episodes');

    console.log('Sync liens...');
    const allLiens = await neonDb.select().from(liens);
    await batchUpsert('liens', allLiens.map(l => ({
        id: l.id, media_id: l.mediaId, episode_id: l.episodeId, source_site: l.sourceSite,
        player_host: l.playerHost, url: l.url, quality: l.quality, language: l.language,
        has_subtitles: l.hasSubtitles ? 1 : 0, headers: l.headers ? JSON.stringify(l.headers) : null,
        is_active: l.isActive ? 1 : 0, fail_count: l.failCount,
        last_verified: l.lastVerified?.toISOString(), scraped_at: l.scrapedAt?.toISOString()
    })), 'liens');

    console.log(`✅ Sync Turso termine: ${allMedias.length} medias, ${allEpisodes.length} episodes, ${allLiens.length} links.`);
}

checkLinks().catch(console.error);
