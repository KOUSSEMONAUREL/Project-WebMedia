import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { createNeonClient, createTursoClient } from './db/client.js';
import { medias, episodes, liens, importOffsets } from './db/neon/schema.js';
import { medias as tursoMedias, episodes as tursoEpisodes, liens as tursoLiens } from './db/turso/schema.js';
import { createLog } from './utils/log.js';

const BATCH = 100;
const PAGE_SIZE = 1000;
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;
const SYNC_KEYS = {
    medias: 'turso_last_sync_medias_ms',
    episodes: 'turso_last_sync_episodes_ms',
    liens: 'turso_last_sync_liens_ms',
} as const;
const LEGACY_SYNC_KEY = 'turso_last_sync_ms';
const MAX_ROWS = parseInt(process.env.SYNC_MAX_ROWS || '0', 10);
const SKIP_OFFSETS = process.env.SYNC_SKIP_OFFSETS === '1';
const SKIP_MAINTENANCE = process.env.SYNC_SKIP_MAINTENANCE === '1';

// Types toujours syncés vers Turso même sans lien actif (book: pas de liens requis,
// film/serie/anime: les liens passent par des embedders, pas par la table liens).
const ALWAYS_SYNCED_TYPES = ['book', 'film', 'serie', 'anime'];

// Un lien n'est exploitable que si son URL est absolue. 2276 liens sur 11504
// sont des chemins relatifs ('/chapter/...') ou de purs fragments ('#...') :
// le site les rendrait en href casses vers webmediia.cfd, et 53 medias
// n'avaient que ça. Interroge la conformity ET le compteur sur ce critere.
const URL_ABSOLUE = 'http%';

type Logger = ReturnType<typeof createLog>;
type MediaRow = typeof medias.$inferSelect;
type EpisodeRow = typeof episodes.$inferSelect;
type LienRow = typeof liens.$inferSelect;

function errMsg(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// Un média est conforme (mérite d'être dans Turso) s'il est d'un type toujours
// syncé ou s'il possède au moins un lien actif. COUNT réel sur la table liens,
// pas le compteur active_links_count (non fiable pour book/novel).
function conformesFilter(
    m: typeof medias | typeof tursoMedias,
    l: typeof liens | typeof tursoLiens,
) {
    return sql`(${m.type} IN (${sql.join(ALWAYS_SYNCED_TYPES.map(t => sql`${t}`), sql`, `)}) OR EXISTS (SELECT 1 FROM ${l} WHERE ${l.mediaId} = ${m.id} AND ${l.isActive} = true AND ${l.url} LIKE ${URL_ABSOLUE}))`;
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
        const pageSize = MAX_ROWS > 0 ? Math.min(PAGE_SIZE, MAX_ROWS - rows.length) : PAGE_SIZE;
        if (pageSize <= 0) break;
        const page = await retry(`fetch ${label}`, log, () => selectPage(lastId, pageSize));
        rows.push(...page);
        if (page.length < pageSize) break;
        lastId = (page[page.length - 1] as { id: string }).id;
    }
    return rows;
}

export function mediaUpsert() {
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
        },
        setWhere: sql`COALESCE(excluded.updated_at, 0) > COALESCE(${tursoMedias.updatedAt}, 0)`,
    };
}

export function episodeUpsert() {
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
        },
        setWhere: sql`COALESCE(excluded.updated_at, 0) > COALESCE(${tursoEpisodes.updatedAt}, 0)`,
    };
}

export function lienUpsert() {
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
        },
        setWhere: sql`COALESCE(excluded.updated_at, 0) > COALESCE(${tursoLiens.updatedAt}, 0)`,
    };
}

export async function syncNeonToTurso(
    neonUrl: string,
    tursoUrl: string,
    tursoToken: string,
    opts?: { forceFullSync?: boolean },
) {
    const log = createLog('Sync Turso', 'sync');

    if (!tursoUrl || !tursoToken) {
        log.warn('Turso non configure, sync ignore');
        return;
    }

    const neon = createNeonClient(neonUrl);
    const turso = createTursoClient(tursoUrl, tursoToken);

    log.start('Syncing Neon -> Turso');

    try {
        const offsetRows = await neon.select().from(importOffsets);
        const offsetMap = new Map(offsetRows.map(row => [row.key, Number(row.value)]));
        const legacyOffset = offsetMap.get(LEGACY_SYNC_KEY) ?? 0;

        const offsetFor = (key: string) => {
            if (opts?.forceFullSync) return 0;
            return offsetMap.get(key) ?? legacyOffset;
        };

        const mediasLastSyncMs = offsetFor(SYNC_KEYS.medias);
        const episodesLastSyncMs = offsetFor(SYNC_KEYS.episodes);
        const liensLastSyncMs = offsetFor(SYNC_KEYS.liens);

        if (!opts?.forceFullSync) {
            for (const key of Object.values(SYNC_KEYS)) {
                if (!offsetMap.has(key)) {
                    log.warn(`Offset ${key} absent, fallback sur ${LEGACY_SYNC_KEY}`);
                }
            }
        }

        if (mediasLastSyncMs === 0 || episodesLastSyncMs === 0 || liensLastSyncMs === 0) {
            log.info('Aucun offset trouve: full sync pour etablir la baseline');
        }

        const startedAtMs = Date.now();
        const mediasSinceIso = mediasLastSyncMs > 0 ? new Date(mediasLastSyncMs).toISOString() : null;
        const episodesSinceIso = episodesLastSyncMs > 0 ? new Date(episodesLastSyncMs).toISOString() : null;
        const liensSinceIso = liensLastSyncMs > 0 ? new Date(liensLastSyncMs).toISOString() : null;

        const saveOffset = async (key: string, value: number) => {
            await neon.insert(importOffsets)
                .values({ key, value })
                .onConflictDoUpdate({
                    target: importOffsets.key,
                    set: { value, updatedAt: new Date() },
                });
        };

        // Médias: modifiés depuis l'offset, ou dont un lien a été modifié depuis
        // l'offset (un média qui reçoit ses premiers liens n'a pas son updated_at
        // bumpé: l'ingest ne met à jour que active_links_count).
        const mediaSince = mediasSinceIso
            ? sql`(${medias.updatedAt} > ${mediasSinceIso} OR EXISTS (SELECT 1 FROM ${liens} WHERE ${liens.mediaId} = ${medias.id} AND ${liens.updatedAt} > ${mediasSinceIso}))`
            : sql`1=1`;
        const episodeSince = episodesSinceIso ? sql`${episodes.updatedAt} > ${episodesSinceIso}` : sql`1=1`;
        const lienSince = liensSinceIso ? sql`${liens.updatedAt} > ${liensSinceIso}` : sql`1=1`;

        const changedMedias = await fetchAllPages<MediaRow>(
            (lastId, pageSize) => neon.select().from(medias)
                .where(lastId === undefined
                    ? sql`${mediaSince} AND ${conformesFilter(medias, liens)}`
                    : sql`${mediaSince} AND ${conformesFilter(medias, liens)} AND id > ${lastId}`)
                .orderBy(sql`id`)
                .limit(pageSize),
            'medias',
            log,
        );
        let mediaRowsAffected = 0;
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
                const result = await retry(`insert medias batch ${i / BATCH + 1}`, log, () =>
                    turso.insert(tursoMedias).values(batch).onConflictDoUpdate(mediaUpsert()),
                );
                mediaRowsAffected += Number(result.rowsAffected ?? 0);
            }
            log.info(`${changedMedias.length} medias traites, ${mediaRowsAffected} lignes ecrites`);
        }
        if (!opts?.forceFullSync && !SKIP_OFFSETS) {
            await saveOffset(SYNC_KEYS.medias, startedAtMs);
        }

        const tursoMediaRows = await retry('fetch turso media ids', log, () =>
            turso.select({ id: tursoMedias.id }).from(tursoMedias),
        );
        const tursoMediaIds = new Set(tursoMediaRows.map(row => row.id));

        const changedEpisodes = await fetchAllPages<EpisodeRow>(
            (lastId, pageSize) => neon.select().from(episodes)
                .where(lastId === undefined ? episodeSince : sql`${episodeSince} AND id > ${lastId}`)
                .orderBy(sql`id`)
                .limit(pageSize),
            'episodes',
            log,
        );
        const syncableEpisodes = changedEpisodes.filter(e => tursoMediaIds.has(e.mediaId));
        const skippedEpisodes = changedEpisodes.length - syncableEpisodes.length;
        if (skippedEpisodes > 0) {
            log.warn(`${skippedEpisodes} episodes ignores: media absent de Turso`);
        }
        let episodeRowsAffected = 0;
        if (syncableEpisodes.length > 0) {
            log.start(`Syncing ${syncableEpisodes.length} episodes`);
            for (let i = 0; i < syncableEpisodes.length; i += BATCH) {
                const batch = syncableEpisodes.slice(i, i + BATCH).map(e => ({
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
                const result = await retry(`insert episodes batch ${i / BATCH + 1}`, log, () =>
                    turso.insert(tursoEpisodes).values(batch).onConflictDoUpdate(episodeUpsert()),
                );
                episodeRowsAffected += Number(result.rowsAffected ?? 0);
            }
            log.info(`${syncableEpisodes.length} episodes traites, ${episodeRowsAffected} lignes ecrites`);
        }
        if (!opts?.forceFullSync && !SKIP_OFFSETS) {
            await saveOffset(SYNC_KEYS.episodes, startedAtMs);
        }

        const changedLiens = await fetchAllPages<LienRow>(
            (lastId, pageSize) => neon.select().from(liens)
                .where(lastId === undefined ? lienSince : sql`${lienSince} AND id > ${lastId}`)
                .orderBy(sql`id`)
                .limit(pageSize),
            'liens',
            log,
        );
        const syncableLiens = changedLiens.filter(l => tursoMediaIds.has(l.mediaId));
        const skippedLiens = changedLiens.filter(l => !tursoMediaIds.has(l.mediaId));
        if (skippedLiens.length > 0) {
            const sample = skippedLiens.slice(0, 20).map(l => `${l.id}:${l.mediaId}`).join(', ');
            log.warn(`${skippedLiens.length} liens orphelins ignores (media absent de Turso): ${sample}${skippedLiens.length > 20 ? ', ...' : ''}`);
        }
        let lienRowsAffected = 0;
        if (syncableLiens.length > 0) {
            log.start(`Syncing ${syncableLiens.length} liens`);
            for (let i = 0; i < syncableLiens.length; i += BATCH) {
                const batch = syncableLiens.slice(i, i + BATCH).map(l => ({
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
                const result = await retry(`insert liens batch ${i / BATCH + 1}`, log, () =>
                    turso.insert(tursoLiens).values(batch).onConflictDoUpdate(lienUpsert()),
                );
                lienRowsAffected += Number(result.rowsAffected ?? 0);
            }
            log.info(`${syncableLiens.length} liens traites, ${lienRowsAffected} lignes ecrites`);
        }
        if (!opts?.forceFullSync && !SKIP_OFFSETS) {
            await saveOffset(SYNC_KEYS.liens, startedAtMs);
        }

        if (!SKIP_MAINTENANCE) {
        // Purge quotidienne: un média sans lien actif (hors types toujours syncés)
        // n'a rien de consommable dans Turso. DELETE direct par subquery (pas de fetch
        // d'IDs en mémoire). Le WHERE NOT conformes est évalué par SQLite server-side.
        const tursoConformes = conformesFilter(tursoMedias, tursoLiens);
        const staleSub = sql`(SELECT id FROM ${tursoMedias} WHERE NOT ${tursoConformes})`;
        const staleCount = await retry('count medias a purger', log, () =>
            turso.select({ n: sql<number>`count(*)` }).from(tursoMedias).where(sql`NOT ${tursoConformes}`),
        );
        if ((staleCount[0]?.n ?? 0) > 0) {
            log.start(`Purge: ${staleCount[0].n} medias sans lien actif a retirer de Turso`);
            await retry('purge liens des medias obsoletes', log, () =>
                turso.delete(tursoLiens).where(sql`${tursoLiens.mediaId} IN ${staleSub}`),
            );
            await retry('purge episodes des medias obsoletes', log, () =>
                turso.delete(tursoEpisodes).where(sql`${tursoEpisodes.mediaId} IN ${staleSub}`),
            );
            const deleted = await retry('purge medias obsoletes', log, () =>
                turso.delete(tursoMedias).where(sql`NOT ${tursoConformes}`),
            );
            log.info(`${deleted.rowsAffected} medias sans lien actif purges de Turso`);
        }

        // Nettoyage des orphelins (liens/episodes dont le média n'existe plus en Turso):
        // couvre les médias supprimés de Neon et les purges précédentes sans cascade.
        const orphanLiens = await retry('purge liens orphelins', log, () =>
            turso.delete(tursoLiens).where(sql`${tursoLiens.mediaId} NOT IN (SELECT id FROM ${tursoMedias})`),
        );
        const orphanEpisodes = await retry('purge episodes orphelins', log, () =>
            turso.delete(tursoEpisodes).where(sql`${tursoEpisodes.mediaId} NOT IN (SELECT id FROM ${tursoMedias})`),
        );
        if (orphanLiens.rowsAffected > 0 || orphanEpisodes.rowsAffected > 0) {
            log.info(`${orphanLiens.rowsAffected} liens et ${orphanEpisodes.rowsAffected} episodes orphelins purges de Turso`);
        }

        // Recalcul de active_links_count. Seul l'ingesteur le met a jour, et il ne
        // passe pas pour book/novel/webtoon/comic : le compteur derive en silence
        // (0 alors que les liens existent, ou 1285 au lieu de 18). Consequence
        // concrete : search.ts voit activeLinksCount = 0 et relance un scrape sur
        // chaque apparition du media. Meme semantique que l'ingesteur (COUNT des
        // liens, sans filtre is_active, URL absolue requise) pour que le compteur
        // reste comparable a celui de Neon et ne compte pas des href casses.
        const fixedCounters = await retry('recalcul active_links_count', log, () =>
            turso.run(sql`UPDATE ${tursoMedias} SET active_links_count = COALESCE((SELECT COUNT(*) FROM ${tursoLiens} WHERE ${tursoLiens.mediaId} = ${tursoMedias}.id AND ${tursoLiens.url} LIKE ${URL_ABSOLUE}), 0)`),
        );
        if (fixedCounters.rowsAffected > 0) {
            log.info(`${fixedCounters.rowsAffected} compteurs active_links_count recalcules`);
        }

        }

        log.success(`Sync: ${changedMedias.length} medias, ${syncableEpisodes.length}/${changedEpisodes.length} episodes, ${syncableLiens.length}/${changedLiens.length} liens (${mediaRowsAffected + episodeRowsAffected + lienRowsAffected} lignes ecrites)`);
    } catch (error: unknown) {
        log.error(`Sync Error: ${errMsg(error)}`);
        throw error;
    } finally {
        try { await neon.$client.end(); } catch { /* ignore */ }
        try { turso.$client.close(); } catch { /* ignore */ }
    }
}
