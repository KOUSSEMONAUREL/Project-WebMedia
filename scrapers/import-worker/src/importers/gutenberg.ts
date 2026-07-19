import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias, liens } from '../db/neon/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { batchCheckExisting, notifyBrain, withRetry } from '../utils/batch-import.js';
import { getOffset, setOffset } from '../utils/offset-tracker.js';
import { createLog } from '../utils/log.js';

const PG_API = 'https://project-gutenberg-free-books-api1.p.rapidapi.com/books';
const KEY = 'gutenberg';

async function processGutenbergPage(db: any, pageNum: number, limit: number, log: ReturnType<typeof createLog>): Promise<number> {
    const gutenbergKey = process.env.GUTENBERG_API_KEY || '';
    if (!gutenbergKey) return 0;

    const response = await withRetry(() => axios.get(PG_API, {
        params: { q: 'popular', page_size: limit, page: pageNum },
        headers: {
            'X-RapidAPI-Key': gutenbergKey,
            'X-RapidAPI-Host': 'project-gutenberg-free-books-api1.p.rapidapi.com'
        }
    }));

    const results = (response.data?.results || response.data || []) as any[];
    if (results.length === 0) return 0;

    const externalIds = results.map((item: any) => `gutenberg-${item.id}`);
    const existing = await batchCheckExisting(db, medias.externalId, externalIds);

    const toInsert = results.filter((item: any) => !existing.has(`gutenberg-${item.id}`));
    if (toInsert.length === 0) {
        log.skip(`Gutenberg page ${pageNum}: all existing`);
        return 0;
    }

    const mediaValues = toInsert.map((item: any) => {
        const title = (item.title || '').substring(0, 490);
        const externalId = `gutenberg-${item.id}`;
        const authors = (item.authors?.map((a: any) => a.name).join(', ') || 'Unknown').substring(0, 290);
        const slug = `book-${externalId}-${title.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, '')}`.substring(0, 490);
        return {
            type: 'book', title, originalTitle: title, author: authors,
            synopsis: item.synopsis || `Project Gutenberg — ${title}`,
            posterUrl: item.cover_image || undefined,
            externalId, slug,
            metadataSource: 'gutenberg', metadataFreshAt: new Date()
        };
    });

    const inserted: any[] = await db.insert(medias).values(mediaValues).onConflictDoNothing().returning({ id: medias.id, externalId: medias.externalId, title: medias.title, slug: medias.slug });

    const lienValues = inserted.map(m => ({
        mediaId: m.id, sourceSite: 'gutenberg',
        url: `https://www.gutenberg.org/ebooks/${m.externalId?.replace('gutenberg-', '')}`,
        quality: 'original', language: 'EN',
    }));

    if (lienValues.length > 0) {
        await db.insert(liens).values(lienValues).onConflictDoNothing().catch(() => {});
    }

    for (const m of inserted) {
        try {
            await notifyBrain(m.id, 'book', process.env.INTERNAL_API_URL!, process.env.INTERNAL_API_KEY!, m.title, m.slug);
        } catch { /* ignore brain errors */ }
    }

    log.success(`Project Gutenberg: ${inserted.length} added (page ${pageNum})`);
    return inserted.length;
}

export async function importGutenberg(databaseUrl: string, limit: number = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    const log = createLog('Gutenberg', 'one-shot');
    log.start(`Import (limit=${limit})`);

    try {
        const page = await getOffset(KEY, databaseUrl, 1);
        if (!process.env.GUTENBERG_API_KEY) {
            log.warn('GUTENBERG_API_KEY not set, skip');
            return 0;
        }

        // Freshness pass: always check page 1 for new popular books
        let freshCount = 0;
        if (page > 1) {
            try {
                freshCount = await processGutenbergPage(db, 1, limit, log);
                if (freshCount > 0) log.info(`Freshness: ${freshCount} new books`);
            } catch (err: any) {
                log.warn(`Freshness pass failed: ${err.message}`);
            }
        }

        // Deep pass: continue from stored page
        const deepCount = await processGutenbergPage(db, page, limit, log);
        if (deepCount === 0) {
            // If page returned empty, reset (handled inside processGutenbergPage as return 0)
        }
        await setOffset(KEY, page + 1, databaseUrl);
        return deepCount + freshCount;
    } catch (error: any) {
        log.error(`Project Gutenberg Import Error: ${error.message}`);
        throw error;
    }
}
