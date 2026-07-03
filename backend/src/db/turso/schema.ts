import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

// ========== TABLE MEDIAS (Catalogue principal) ==========
export const medias = sqliteTable('medias', {
    id: text('id').primaryKey(), // UUID format
    externalId: text('external_id'),
    type: text('type').notNull(),
    title: text('title').notNull(),
    originalTitle: text('original_title'),
    slug: text('slug').notNull().unique(),
    synopsis: text('synopsis'),
    year: integer('year'),
    author: text('author'),
    posterUrl: text('poster_url'),
    backdropUrl: text('backdrop_url'),
    rating: text('rating'), // On garde text pour correspondre au decimal de PG
    voteCount: integer('vote_count').default(0),
    status: text('status'),
    tmdbId: integer('tmdb_id'),
    imdbId: text('imdb_id'),
    anilistId: integer('anilist_id'),
    malId: integer('mal_id'),
    kitsuId: integer('kitsu_id'),
    igdbId: integer('igdb_id'),
    anidbId: integer('anidb_id'),
    metadataSource: text('metadata_source').default('tmdb'),
    metadataFreshAt: integer('metadata_fresh_at', { mode: 'timestamp' }),
    linksLastScrapedAt: integer('links_last_scraped_at', { mode: 'timestamp' }),
    activeLinksCount: integer('active_links_count').default(0),
    genres: text('genres'),
    trailerUrl: text('trailer_url'),
    tagline: text('tagline'),
    studios: text('studios'),
    episodeCount: integer('episode_count'),
    createdAt: integer('created_at', { mode: 'timestamp' }),
    updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

// ========== TABLE EPISODES ==========
export const episodes = sqliteTable('episodes', {
    id: text('id').primaryKey(),
    mediaId: text('media_id').notNull().references(() => medias.id, { onDelete: 'cascade' }),
    seasonNumber: integer('season_number').notNull(),
    episodeNumber: integer('episode_number').notNull(),
    title: text('title'),
    synopsis: text('synopsis'),
    airDate: integer('air_date', { mode: 'timestamp' }),
    thumbnailUrl: text('thumbnail_url'),
    duration: integer('duration'),
});

// ========== TABLE LIENS (Scraping) ==========
export const liens = sqliteTable('liens', {
    id: text('id').primaryKey(),
    mediaId: text('media_id').notNull().references(() => medias.id, { onDelete: 'cascade' }),
    episodeId: text('episode_id').references(() => episodes.id, { onDelete: 'cascade' }),
    sourceSite: text('source_site').notNull(),
    playerHost: text('player_host'),
    url: text('url').notNull(),
    quality: text('quality'),
    language: text('language'),
    hasSubtitles: integer('has_subtitles', { mode: 'boolean' }).default(false),
    isActive: integer('is_active', { mode: 'boolean' }).default(true),
    failCount: integer('fail_count').default(0),
    lastVerified: integer('last_verified', { mode: 'timestamp' }),
    scrapedAt: integer('scraped_at', { mode: 'timestamp' }),
});

// ========== RELATIONS ==========
export const mediaRelations = relations(medias, ({ many }) => ({
    episodes: many(episodes),
    liens: many(liens),
}));

export const episodeRelations = relations(episodes, ({ one, many }) => ({
    media: one(medias, {
        fields: [episodes.mediaId],
        references: [medias.id],
    }),
    liens: many(liens),
}));

export const lienRelations = relations(liens, ({ one }) => ({
    media: one(medias, {
        fields: [liens.mediaId],
        references: [medias.id],
    }),
    episode: one(episodes, {
        fields: [liens.episodeId],
        references: [episodes.id],
    }),
}));
