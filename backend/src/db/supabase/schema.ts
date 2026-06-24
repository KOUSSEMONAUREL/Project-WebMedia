import { pgTable, uuid, text, varchar, timestamp, boolean, integer } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ========== TABLE USERS ==========
export const users = pgTable('users', {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    username: varchar('username', { length: 100 }).notNull().unique(),
    passwordHash: varchar('password_hash', { length: 255 }),
    avatarUrl: text('avatar_url'),
    isVerified: boolean('is_verified').default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ========== TABLE REVIEWS ==========
export const reviews = pgTable('reviews', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    mediaId: varchar('media_id', { length: 100 }).notNull(), // Référence vers Neon
    rating: integer('rating').notNull(), // 1-10
    comment: text('comment'),
    spoiler: boolean('spoiler').default(false),
    likes: integer('likes').default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ========== TABLE FAVORITES ==========
export const favorites = pgTable('favorites', {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    mediaId: varchar('media_id', { length: 100 }).notNull(), // Référence vers Neon
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ========== TABLE SCRAPING_JOBS (Queue) ==========
export const scrapingJobs = pgTable('scraping_jobs', {
    id: uuid('id').primaryKey().defaultRandom(),
    mediaId: varchar('media_id', { length: 100 }).notNull(),
    mediaType: varchar('media_type', { length: 20 }).notNull(),
    workerType: varchar('worker_type', { length: 20 }).notNull().default('cheerio'), // cheerio, playwright, import
    title: varchar('title', { length: 500 }),
    slug: varchar('slug', { length: 500 }),
    status: varchar('status', { length: 20 }).notNull().default('pending'), // pending, processing, completed, failed
    priority: integer('priority').default(0),
    attempts: integer('attempts').default(0),
    lastError: text('last_error'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ========== TABLE KEiyoushi_STATE (persistance cache monitor) ==========
export const keiyoushiState = pgTable('keiyoushi_state', {
    key: varchar('key', { length: 50 }).primaryKey(),
    value: text('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ========== RELATIONS ==========
export const userRelations = relations(users, ({ many }) => ({
    reviews: many(reviews),
    favorites: many(favorites),
}));

export const reviewRelations = relations(reviews, ({ one }) => ({
    user: one(users, {
        fields: [reviews.userId],
        references: [users.id],
    }),
}));

