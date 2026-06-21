import { pgTable, uuid, text, integer, timestamp, decimal, jsonb, varchar, boolean } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ========== TABLE MEDIA ==========
// Stocke tous les médias (films, séries, animés, jeux, webtoons)
export const media = pgTable('media', {
    id: uuid('id').primaryKey().defaultRandom(),
    externalId: varchar('external_id', { length: 100 }), // ID TMDB/AniList/Steam
    type: varchar('type', { length: 20, enum: ['film', 'serie', 'anime', 'jeu', 'webtoon'] }).notNull(),
    title: varchar('title', { length: 500 }).notNull(),
    slug: varchar('slug', { length: 500 }).notNull().unique(), // URL-friendly
    synopsis: text('synopsis'),
    year: integer('year'),
    posterUrl: text('poster_url'),
    backdropUrl: text('backdrop_url'),
    rating: decimal('rating', { precision: 3, scale: 1 }), // Ex: 8.5
    voteCount: integer('vote_count').default(0),
    metadata: jsonb('metadata'), // Données spécifiques par type
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ========== TABLE GENRES ==========
export const genres = pgTable('genres', {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull().unique(),
    slug: varchar('slug', { length: 100 }).notNull().unique(),
    type: varchar('type', { length: 20 }), // film, serie, anime, etc.
});

// ========== TABLE MEDIA_GENRES (Many-to-Many) ==========
export const mediaGenres = pgTable('media_genres', {
    mediaId: uuid('media_id').notNull().references(() => media.id, { onDelete: 'cascade' }),
    genreId: uuid('genre_id').notNull().references(() => genres.id, { onDelete: 'cascade' }),
});

// ========== TABLE LEGAL_LINKS ==========
// Liens vers les plateformes légales (Netflix, etc.)
export const legalLinks = pgTable('legal_links', {
    id: uuid('id').primaryKey().defaultRandom(),
    mediaId: uuid('media_id').notNull().references(() => media.id, { onDelete: 'cascade' }),
    platform: varchar('platform', { length: 100 }).notNull(), // Netflix, Disney+, etc.
    url: text('url').notNull(),
    type: varchar('type', { length: 20, enum: ['stream', 'buy', 'rent'] }).notNull(),
    region: varchar('region', { length: 5 }).default('FR'),
    quality: varchar('quality', { length: 20 }), // HD, 4K
});

// ========== TABLE USERS ==========
export const users = pgTable('users', {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    username: varchar('username', { length: 100 }).notNull().unique(),
    passwordHash: text('password_hash'), // Pour auth custom (optionnel si OAuth)
    avatarUrl: text('avatar_url'),
    isVerified: boolean('is_verified').default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ========== TABLE REVIEWS ==========
// Avis utilisateurs sur les médias
export const reviews = pgTable('reviews', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id').notNull().references(() => media.id, { onDelete: 'cascade' }),
    rating: integer('rating').notNull(), // 1-10
    comment: text('comment'),
    likes: integer('likes').default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ========== TABLE FAVORITES ==========
// Médias favoris des utilisateurs
export const favorites = pgTable('favorites', {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id').notNull().references(() => media.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ========== RELATIONS DRIZZLE ==========
// Pour faire des JOINs facilement

export const mediaRelations = relations(media, ({ many }) => ({
    genres: many(mediaGenres),
    legalLinks: many(legalLinks),
    reviews: many(reviews),
    favorites: many(favorites),
}));

export const genreRelations = relations(genres, ({ many }) => ({
    media: many(mediaGenres),
}));

export const mediaGenreRelations = relations(mediaGenres, ({ one }) => ({
    media: one(media, {
        fields: [mediaGenres.mediaId],
        references: [media.id],
    }),
    genre: one(genres, {
        fields: [mediaGenres.genreId],
        references: [genres.id],
    }),
}));

export const reviewRelations = relations(reviews, ({ one }) => ({
    user: one(users, {
        fields: [reviews.userId],
        references: [users.id],
    }),
    media: one(media, {
        fields: [reviews.mediaId],
        references: [media.id],
    }),
}));

export const userRelations = relations(users, ({ many }) => ({
    reviews: many(reviews),
    favorites: many(favorites),
}));
