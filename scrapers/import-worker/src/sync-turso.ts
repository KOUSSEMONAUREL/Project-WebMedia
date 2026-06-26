import { createNeonClient, createTursoClient } from './db/client.js';
import { medias, episodes, liens } from './db/neon/schema.js';
import { medias as tursoMedias, episodes as tursoEpisodes, liens as tursoLiens } from './db/turso/schema.js';

const BATCH = 100;

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
                await turso.insert(tursoMedias).values(batch).onConflictDoNothing();
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
                await turso.insert(tursoEpisodes).values(batch).onConflictDoNothing();
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
                await turso.insert(tursoLiens).values(batch).onConflictDoNothing();
            }
        }

        console.log(`✅ Sync finished: ${allMedias.length} medias, ${allEpisodes.length} episodes, ${allLiens.length} links.`);
    } catch (error: any) {
        console.error('❌ Sync Error:', error.message);
    }
}