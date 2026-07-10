import { pgTable, uuid, text, varchar, timestamp, boolean, integer } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ========== BETTER AUTH TABLES ==========
export const user = pgTable('user', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull(),
    image: text('image'),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
});

export const session = pgTable('session', {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
});

export const account = pgTable('account', {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
});

export const verification = pgTable('verification', {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
});

// ========== TABLE REVIEWS ==========
export const reviews = pgTable('reviews', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    mediaId: varchar('media_id', { length: 100 }).notNull(),
    rating: integer('rating').notNull(),
    comment: text('comment'),
    spoiler: boolean('spoiler').default(false),
    likes: integer('likes').default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ========== TABLE FAVORITES ==========
export const favorites = pgTable('favorites', {
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    mediaId: varchar('media_id', { length: 100 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ========== TABLE WATCH_HISTORY ==========
export const watchHistory = pgTable('watch_history', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    mediaId: varchar('media_id', { length: 100 }).notNull(),
    type: varchar('type', { length: 20 }).notNull(),
    title: text('title').notNull(),
    slug: varchar('slug', { length: 255 }).notNull(),
    posterUrl: text('poster_url'),
    visitedAt: timestamp('visited_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ========== TABLE SCRAPING_JOBS ==========
export const scrapingJobs = pgTable('scraping_jobs', {
    id: uuid('id').primaryKey().defaultRandom(),
    mediaId: varchar('media_id', { length: 100 }).notNull(),
    mediaType: varchar('media_type', { length: 20 }).notNull(),
    workerType: varchar('worker_type', { length: 20 }).notNull(),
    title: varchar('title', { length: 500 }),
    slug: varchar('slug', { length: 500 }),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    priority: integer('priority').default(0),
    attempts: integer('attempts').default(0),
    lastError: text('last_error'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ========== TABLE ADMIN_USERS ==========
export const adminUsers = pgTable('admin_users', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull().unique().references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ========== TABLE KEiyoushi_STATE ==========
export const keiyoushiState = pgTable('keiyoushi_state', {
    key: varchar('key', { length: 50 }).primaryKey(),
    value: text('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ========== RELATIONS ==========
export const userRelations = relations(user, ({ many }) => ({
    reviews: many(reviews),
    favorites: many(favorites),
    watchHistory: many(watchHistory),
}));

export const reviewRelations = relations(reviews, ({ one }) => ({
    user: one(user, {
        fields: [reviews.userId],
        references: [user.id],
    }),
}));
