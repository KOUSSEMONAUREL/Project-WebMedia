import { pgTable, uuid, text, integer, timestamp, varchar } from 'drizzle-orm/pg-core';

// ========== TABLE SCRAPING_JOBS (Queue) ==========
export const scrapingJobs = pgTable('scraping_jobs', {
    id: uuid('id').primaryKey().defaultRandom(),
    mediaId: varchar('media_id', { length: 100 }).notNull(),
    mediaType: varchar('media_type', { length: 20 }).notNull(),
    workerType: varchar('worker_type', { length: 20 }).notNull().default('cheerio'),
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
