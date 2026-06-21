import { pgTable, uuid, text, varchar, timestamp, integer, decimal, boolean } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
// ========== TABLE MEDIAS (Catalogue principal) ==========
export const medias = pgTable('medias', {
    id: uuid('id').primaryKey().defaultRandom(),
    externalId: varchar('external_id', { length: 100 }), // ID TMDB/AniList
    type: varchar('type', { length: 20 }).notNull(), // film, serie, anime, jeu
    title: varchar('title', { length: 500 }).notNull(),
    originalTitle: varchar('original_title', { length: 500 }),
    slug: varchar('slug', { length: 500 }).notNull().unique(),
    synopsis: text('synopsis'),
    year: integer('year'),
    posterUrl: text('poster_url'),
    backdropUrl: text('backdrop_url'),
    rating: decimal('rating', { precision: 3, scale: 1 }),
    voteCount: integer('vote_count').default(0),
    status: varchar('status', { length: 20 }), // Released, Upcoming, Ended
    tmdbId: integer('tmdb_id'),
    imdbId: varchar('imdb_id', { length: 20 }),
    anilistId: integer('anilist_id'),
    malId: integer('mal_id'),
    kitsuId: integer('kitsu_id'),
    igdbId: integer('igdb_id'),
    anidbId: integer('anidb_id'),
    metadataSource: varchar('metadata_source', { length: 50 }).default('tmdb'),
    metadataFreshAt: timestamp('metadata_fresh_at', { withTimezone: true }),
    linksLastScrapedAt: timestamp('links_last_scraped_at', { withTimezone: true }),
    activeLinksCount: integer('active_links_count').default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
// ========== TABLE EPISODES ==========
export const episodes = pgTable('episodes', {
    id: uuid('id').primaryKey().defaultRandom(),
    mediaId: uuid('media_id').notNull().references(() => medias.id, { onDelete: 'cascade' }),
    seasonNumber: integer('season_number').notNull(),
    episodeNumber: integer('episode_number').notNull(),
    title: varchar('title', { length: 500 }),
    synopsis: text('synopsis'),
    airDate: timestamp('air_date'),
    thumbnailUrl: text('thumbnail_url'),
    duration: integer('duration'), // en minutes
});
// ========== TABLE LIENS (Scraping) ==========
export const liens = pgTable('liens', {
    id: uuid('id').primaryKey().defaultRandom(),
    mediaId: uuid('media_id').notNull().references(() => medias.id, { onDelete: 'cascade' }),
    episodeId: uuid('episode_id').references(() => episodes.id, { onDelete: 'cascade' }),
    sourceSite: varchar('source_site', { length: 100 }).notNull(), // AnimeSama, etc.
    playerHost: varchar('player_host', { length: 100 }), // Voe, Streamtape
    url: text('url').notNull(),
    quality: varchar('quality', { length: 20 }), // 1080p, 720p
    language: varchar('language', { length: 20 }), // Vostfr, Vf
    hasSubtitles: boolean('has_subtitles').default(false),
    isActive: boolean('is_active').default(true),
    failCount: integer('fail_count').default(0),
    lastVerified: timestamp('last_verified'),
    scrapedAt: timestamp('scraped_at').defaultNow(),
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
