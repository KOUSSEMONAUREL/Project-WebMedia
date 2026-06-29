import { sql } from 'drizzle-orm';
import { createNeonClient, createTursoClient } from './db/client.js';
import { medias, episodes, liens } from './db/neon/schema.js';
import { medias as tursoMedias, episodes as tursoEpisodes, liens as tursoLiens } from './db/turso/schema.js';

const BATCH = 100;

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
        }
    };
}

export async function syncNeonToTurso(neonUrl: string, tursoUrl: string, tursoToken: string) {
    const neon = createNeonClient(neonUrl);
    const turso = createTursoClient(tursoUrl, tursoToken);

    console.log('🔄 Syncing Neon -> Turso...');

    try {
        const allMedias = await neon.select().from(medias);
        if (allMedias.length > 0) {
            for (let i = 0; i < allMedias.length; i += BATCH) {
                const batch = allMedias.slice(i, i + BATCH).map(m => ({
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
                    activeLinksCount: m.activeLinksCount ?? 0,
                    createdAt: new Date(m.createdAt!),
                    updatedAt: new Date(m.updatedAt!),
                }));
                await turso.insert(tursoMedias).values(batch).onConflictDoUpdate(mediaUpsert());
            }
        }

        const allEpisodes = await neon.select().from(episodes);
        if (allEpisodes.length > 0) {
            for (let i = 0; i < allEpisodes.length; i += BATCH) {
                const batch = allEpisodes.slice(i, i + BATCH).map(e => ({
                    id: e.id,
                    mediaId: e.mediaId,
                    seasonNumber: e.seasonNumber,
                    episodeNumber: e.episodeNumber,
                    title: e.title,
                    synopsis: e.synopsis,
                    airDate: e.airDate ? new Date(e.airDate) : null,
                    thumbnailUrl: e.thumbnailUrl,
                    duration: e.duration,
                }));
                await turso.insert(tursoEpisodes).values(batch).onConflictDoUpdate(episodeUpsert());
            }
        }

        const allLiens = await neon.select().from(liens);
        if (allLiens.length > 0) {
            for (let i = 0; i < allLiens.length; i += BATCH) {
                const batch = allLiens.slice(i, i + BATCH).map(l => ({
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
                }));
                await turso.insert(tursoLiens).values(batch).onConflictDoUpdate(lienUpsert());
            }
        }

        console.log(`✅ Sync finished: ${allMedias.length} medias, ${allEpisodes.length} episodes, ${allLiens.length} links.`);
    } catch (error: any) {
        console.error('❌ Sync Error:', error.message);
    }
}
