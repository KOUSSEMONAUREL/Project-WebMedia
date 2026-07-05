import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias, liens } from '../db/neon/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { batchCheckExisting, notifyBrain, withRetry } from '../utils/batch-import.js';
import { getOffset, setOffset } from '../utils/offset-tracker.js';
import { createLog } from '../utils/log.js';

const PG_API = 'https://project-gutenberg-free-books-api1.p.rapidapi.com/books';
const KEY = 'gutenberg';

export async function importGutenberg(databaseUrl: string, limit: number = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    const log = createLog('Gutenberg', 'one-shot');
    log.start(`Import (limit=${limit})`);

    try {
        const page = await getOffset(KEY, databaseUrl, 1);
        const gutenbergKey = process.env.GUTENBERG_API_KEY || '';
        if (!gutenbergKey) {
            log.warn('GUTENBERG_API_KEY not set, skip');
            return 0;
        }
        const response = await withRetry(() => axios.get(PG_API, {
            params: { q: 'popular', page_size: limit, page },
            headers: {
                'X-RapidAPI-Key': gutenbergKey,
                'X-RapidAPI-Host': 'project-gutenberg-free-books-api1.p.rapidapi.com'
            }
        }));

        const results = (response.data?.results || response.data || []) as any[];
        if (results.length === 0) {
            await setOffset(KEY, 1, databaseUrl);
            log.skip('End of catalog, reset to page 1');
            return 0;
        }

        const externalIds = results.map((item: any) => `gutenberg-${item.id}`);
        const existing = await batchCheckExisting(db, medias.externalId, externalIds);

        const toInsert = results.filter((item: any) => !existing.has(`gutenberg-${item.id}`));
        if (toInsert.length === 0) {
            log.skip(`Gutenberg page ${page}: all existing`);
            await setOffset(KEY, page + 1, databaseUrl);
            return 0;
        }

        const mediaValues = toInsert.map((item: any) => {
            const title = item.title;
            const externalId = `gutenberg-${item.id}`;
            const authors = item.authors?.map((a: any) => a.name).join(', ') || 'Unknown';
            const slug = `book-${externalId}-${title.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, '')}`.substring(0, 490);
            return {
                type: 'book', title, originalTitle: title, author: authors,
                synopsis: item.synopsis || `Project Gutenberg — ${title}`,
                posterUrl: item.cover_image || undefined,
                externalId, slug,
                metadataSource: 'gutenberg', metadataFreshAt: new Date()
            };
        });

        const inserted = await db.insert(medias).values(mediaValues).onConflictDoNothing().returning({ id: medias.id, externalId: medias.externalId, title: medias.title, slug: medias.slug });

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

        log.success(`Project Gutenberg: ${inserted.length} added (page ${page})`);
        return inserted.length;
    } catch (error: any) {
        log.error(`Project Gutenberg Import Error: ${error.message}`);
        throw error;
    }
}
