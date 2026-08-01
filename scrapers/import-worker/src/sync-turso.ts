import { sql, eq } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { createNeonClient, createTursoClient } from './db/client.js';
import { medias, episodes, liens, importOffsets } from './db/neon/schema.js';
import { medias as tursoMedias, episodes as tursoEpisodes, liens as tursoLiens } from './db/turso/schema.js';
import { createLog } from './utils/log.js';

const BATCH = 100;
const PAGE_SIZE = 1000;
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;
const SYNC_KEY = 'turso_last_sync_ms';

type Logger = ReturnType<typeof createLog>;
type MediaRow = typeof medias.$inferSelect;
type EpisodeRow = typeof episodes.$inferSelect;
type LienRow = typeof liens.$inferSelect;

function errMsg(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function retry<T>(label: string, log: Logger, fn: () => Promise<T>): Promise<T> {
    let attempt = 1;
    for (;;) {
        try {
            return await fn();
        } catch (error: unknown) {
            if (attempt >= RETRY_ATTEMPTS) throw error;
            const delay = RETRY_BASE_MS * 2 ** (attempt - 1);
            log.retry(`${label}: ${errMsg(error)}`, attempt, RETRY_ATTEMPTS);
            await new Promise(resolve => setTimeout(resolve, delay));
            attempt++;
        }
    }
}

async function fetchAllPages<TRow extends Record<string, unknown> & { id: string }>(
    selectPage: (lastId: string | undefined, pageSize: number) => Promise<TRow[]>,
    label: string,
    log: Logger,
): Promise<TRow[]> {
    const rows: TRow[] = [];
    let lastId: string | undefined;
    for (;;) {
        const page = await retry(`fetch ${label}`, log, () => selectPage(lastId, PAGE_SIZE));
        rows.push(...page);
        if (page.length < PAGE_SIZE) break;
        lastId = (page[page.length - 1] as { id: string }).id;
    }
    return rows;
}

function mediaUpsert() {
    return {
        target: tursoMedias.id,
        set: {
            externalId: sql`excluded.external_id`,
            type: sql`excluded.type`,
            title: sql`excluded.title`,
            originalTitle: sql`excluded.original_title`,
            slug: sql`excluded.slug`,
            synopsis: sql`excluded.synopsis`,
            year: sql`excluded.year`,
            posterUrl: sql`excluded.poster_url`,
            backdropUrl: sql`excluded.backdrop_url`,
            rating: sql`excluded.rating`,
            author: sql`excluded.author`,
            voteCount: sql`excluded.vote_count`,
            status: sql`excluded.status`,
            tmdbId: sql`excluded.tmdb_id`,
            imdbId: sql`excluded.imdb_id`,
            anilistId: sql`excluded.anilist_id`,
            malId: sql`excluded.mal_id`,
            kitsuId: sql`excluded.kitsu_id`,
            igdbId: sql`excluded.igdb_id`,
            anidbId: sql`excluded.anidb_id`,
            metadataSource: sql`excluded.metadata_source`,
            metadataFreshAt: sql`excluded.metadata_fresh_at`,
            linksLastScrapedAt: sql`excluded.links_last_scraped_at`,
            genres: sql`excluded.genres`,
            activeLinksCount: sql`excluded.active_links_count`,
            createdAt: sql`excluded.created_at`,
            updatedAt: sql`excluded.updated_at`,
        }
    };
}

function episodeUpsert() {
    return {
        target: tursoEpisodes.id,
        set: {
            mediaId: sql`excluded.media_id`,
            seasonNumber: sql`excluded.season_number`,
            episodeNumber: sql`excluded.episode_number`,
            title: sql`excluded.title`,
            synopsis: sql`excluded.synopsis`,
            airDate: sql`excluded.air_date`,
            thumbnailUrl: sql`excluded.thumbnail_url`,
            duration: sql`excluded.duration`,
            updatedAt: sql`excluded.updated_at`,
        }
    };
}

function lienUpsert() {
    return {
        target: tursoLiens.id,
        set: {
            mediaId: sql`excluded.media_id`,
            episodeId: sql`excluded.episode_id`,
            sourceSite: sql`excluded.source_site`,
            playerHost: sql`excluded.player_host`,
            url: sql`excluded.url`,
            quality: sql`excluded.quality`,
            language: sql`excluded.language`,
            hasSubtitles: sql`excluded.has_subtitles`,
            isActive: sql`excluded.is_active`,
            failCount: sql`excluded.fail_count`,
            lastVerified: sql`excluded.last_verified`,
            scrapedAt: sql`excluded.scraped_at`,
            updatedAt: sql`excluded.updated_at`,
        }
    };
}

export async function syncNeonToTurso(neonUrl: string, tursoUrl: string, tursoToken: string) {
    const log = createLog('Sync Turso', 'sync');

    if (!tursoUrl || !tursoToken) {
        log.warn('Turso non configure, sync ignore');
        return;
    }

    const neon = createNeonClient(neonUrl);
    const turso = createTursoClient(tursoUrl, tursoToken);

    log.start('Syncing Neon -> Turso');

    try {
        const [offset] = await neon.select()
            .from(importOffsets)
            .where(eq(importOffsets.key, SYNC_KEY));

        const lastSyncMs = offset?.value ?? 0;
        const hasOffset = !!offset;

        if (lastSyncMs === 0) {
            log.info('Aucun offset trouve: full sync pour etablir la baseline');
        }

        const startedAtMs = Date.now();
        const filterSince = lastSyncMs > 0
            ? sql`updated_at > ${new Date(lastSyncMs).toISOString()}`
            : sql`1=1`;

        const changedMedias = await fetchAllPages<MediaRow>(
            (lastId, pageSize) => neon.select().from(medias)
                .where(lastId === undefined ? filterSince : sql`(${filterSince}) AND id > ${lastId}`)
                .orderBy(sql`id`)
                .limit(pageSize),
            'medias',
            log,
        );
        if (changedMedias.length > 0) {
            log.start(`Syncing ${changedMedias.length} medias`);
            for (let i = 0; i < changedMedias.length; i += BATCH) {
                const batch = changedMedias.slice(i, i + BATCH).map(m => ({
                    id: m.id,
                    externalId: m.externalId,
                    type: m.type,
                    title: m.title,
                    originalTitle: m.originalTitle,
                    slug: m.slug,
                    synopsis: m.synopsis,
                    year: m.year,
                    author: m.author,
                    posterUrl: m.posterUrl,
                    backdropUrl: m.backdropUrl,
                    rating: m.rating?.toString(),
                    voteCount: m.voteCount ?? 0,
                    status: m.status,
                    tmdbId: m.tmdbId,
                    imdbId: m.imdbId,
                    anilistId: m.anilistId,
                    malId: m.malId,
                    kitsuId: m.kitsuId,
                    igdbId: m.igdbId,
                    anidbId: m.anidbId,
                    metadataSource: m.metadataSource ?? 'tmdb',
                    metadataFreshAt: m.metadataFreshAt ? new Date(m.metadataFreshAt) : null,
                    linksLastScrapedAt: m.linksLastScrapedAt ? new Date(m.linksLastScrapedAt) : null,
                    genres: m.genres,
                    activeLinksCount: m.activeLinksCount ?? 0,
                    createdAt: new Date(m.createdAt!),
                    updatedAt: new Date(m.updatedAt!),
                }));
                await retry(`insert medias batch ${i / BATCH + 1}`, log, () =>
                    turso.insert(tursoMedias).values(batch).onConflictDoUpdate(mediaUpsert()),
                );
            }
        }

        const changedEpisodes = await fetchAllPages<EpisodeRow>(
            (lastId, pageSize) => neon.select().from(episodes)
                .where(lastId === undefined ? filterSince : sql`(${filterSince}) AND id > ${lastId}`)
                .orderBy(sql`id`)
                .limit(pageSize),
            'episodes',
            log,
        );
        if (changedEpisodes.length > 0) {
            log.start(`Syncing ${changedEpisodes.length} episodes`);
            for (let i = 0; i < changedEpisodes.length; i += BATCH) {
                const batch = changedEpisodes.slice(i, i + BATCH).map(e => ({
                    id: e.id,
                    mediaId: e.mediaId,
                    seasonNumber: e.seasonNumber,
                    episodeNumber: e.episodeNumber,
                    title: e.title,
                    synopsis: e.synopsis,
                    airDate: e.airDate ? new Date(e.airDate) : null,
                    thumbnailUrl: e.thumbnailUrl,
                    duration: e.duration,
                    updatedAt: e.updatedAt ? new Date(e.updatedAt) : null,
                }));
                await retry(`insert episodes batch ${i / BATCH + 1}`, log, () =>
                    turso.insert(tursoEpisodes).values(batch).onConflictDoUpdate(episodeUpsert()),
                );
            }
        }

        const changedLiens = await fetchAllPages<LienRow>(
            (lastId, pageSize) => neon.select().from(liens)
                .where(lastId === undefined ? filterSince : sql`(${filterSince}) AND id > ${lastId}`)
                .orderBy(sql`id`)
                .limit(pageSize),
            'liens',
            log,
        );
        if (changedLiens.length > 0) {
            log.start(`Syncing ${changedLiens.length} liens`);
            for (let i = 0; i < changedLiens.length; i += BATCH) {
                const batch = changedLiens.slice(i, i + BATCH).map(l => ({
                    id: l.id,
                    mediaId: l.mediaId,
                    episodeId: l.episodeId,
                    sourceSite: l.sourceSite,
                    playerHost: l.playerHost,
                    url: l.url,
                    quality: l.quality,
                    language: l.language,
                    hasSubtitles: l.hasSubtitles ?? false,
                    isActive: l.isActive ?? true,
                    failCount: l.failCount ?? 0,
                    lastVerified: l.lastVerified ? new Date(l.lastVerified) : null,
                    scrapedAt: l.scrapedAt ? new Date(l.scrapedAt) : null,
                    updatedAt: l.updatedAt ? new Date(l.updatedAt) : null,
                }));
                await retry(`insert liens batch ${i / BATCH + 1}`, log, () =>
                    turso.insert(tursoLiens).values(batch).onConflictDoUpdate(lienUpsert()),
                );
            }
        }

        if (lastSyncMs === 0 && changedMedias.length > 0) {
            const allIds = changedMedias.map(m => m.id);
            const deleted = await retry('purge medias obsoletes', log, () =>
                turso.delete(tursoMedias).where(
                    sql`id NOT IN (${sql.join(allIds.map(id => sql`${id}`), sql`, `)})`
                ),
            );
            if (deleted.rowsAffected > 0) log.info(`${deleted.rowsAffected} medias obsoletes nettoyes de Turso`);
        }

        const nowMs = startedAtMs;
        if (hasOffset) {
            await neon.update(importOffsets)
                .set({ value: nowMs, updatedAt: new Date() })
                .where(eq(importOffsets.key, SYNC_KEY));
        } else {
            await neon.insert(importOffsets)
                .values({ key: SYNC_KEY, value: nowMs });
        }

        log.success(`Sync: ${changedMedias.length} medias, ${changedEpisodes.length} episodes, ${changedLiens.length} liens`);
    } catch (error: unknown) {
        log.error(`Sync Error: ${errMsg(error)}`);
    } finally {
        try { await neon.$client.end(); } catch { /* ignore */ }
        try { turso.$client.close(); } catch { /* ignore */ }
    }
}
