import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias, liens } from '../db/neon/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { batchCheckExisting, notifyBrain, withRetry } from '../utils/batch-import.js';
import { getOffset, setOffset } from '../utils/offset-tracker.js';
import { createLog } from '../utils/log.js';

const OPEN_LIBRARY_API = 'https://openlibrary.org';
const KEY = 'openlibrary';

async function processOpenLibraryPage(db: any, pageNum: number, search: string, limit: number, log: ReturnType<typeof createLog>): Promise<number> {
    const response = await withRetry(() => axios.get(`${OPEN_LIBRARY_API}/search.json`, {
        params: { q: search, page: pageNum, limit }
    }));

    const results = response.data.docs || [];
    if (results.length === 0) return 0;

    const externalIds = results.map((item: any) => {
        const key = item?.key || '';
        return `ol-${key.replace('/works/', '')}`;
    }).filter(Boolean);
    const existing = await batchCheckExisting(db, medias.externalId, externalIds);

    const toInsert = results.filter((item: any) => {
        const key = item?.key || '';
        const externalId = `ol-${key.replace('/works/', '')}`;
        return !existing.has(externalId);
    });

    if (toInsert.length === 0) {
        log.skip(`OpenLibrary page ${pageNum}: all existing`);
        return 0;
    }

    const mediaValues = toInsert.map((item: any) => {
        const key = item?.key || '';
        const externalId = `ol-${key.replace('/works/', '')}`;
        const title = item.title;
        const slug = `book-${externalId}-${title.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, '')}`.substring(0, 490);
        const author = item.author_name ? item.author_name.join(', ') : item.authors ? item.authors.map((a: any) => a.name).join(', ') : 'Unknown';
        const genreNames = (item.subject || item.subjects || [])
            .filter((s: string) => typeof s === 'string')
            .slice(0, 5);
        return {
            type: 'book', title, originalTitle: title, author,
            synopsis: item.first_sentence ? item.first_sentence[0] : '',
            posterUrl: item.cover_i ? `https://covers.openlibrary.org/b/id/${item.cover_i}-L.jpg` : undefined,
            genres: genreNames.length ? JSON.stringify(genreNames) : undefined,
            externalId, slug, metadataSource: 'openlibrary', metadataFreshAt: new Date()
        };
    });

    const inserted: any[] = await db.insert(medias).values(mediaValues).onConflictDoNothing().returning({ id: medias.id, externalId: medias.externalId, title: medias.title, slug: medias.slug });

    const lienValues = inserted.map(m => ({
        mediaId: m.id, sourceSite: 'openlibrary',
        url: `${OPEN_LIBRARY_API}/works/${m.externalId?.replace('ol-', '')}`,
        quality: 'original', language: 'EN'
    }));

    if (lienValues.length > 0) {
        await db.insert(liens).values(lienValues).onConflictDoNothing();
    }

    for (const m of inserted) {
        await notifyBrain(m.id, 'book', process.env.INTERNAL_API_URL!, process.env.INTERNAL_API_KEY!, m.title, m.slug);
    }

    log.success(`OpenLibrary: ${inserted.length} added (page ${pageNum})`);
    return inserted.length;
}

export async function importOpenLibrary(databaseUrl: string, search: string = 'popular', limit: number = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    const log = createLog('OpenLibrary', 'one-shot');
    log.start(`Import (search=${search}, limit=${limit})`);

    try {
        const page = await getOffset(KEY, databaseUrl, 1);

        // Freshness pass: always check page 1 for new popular books
        let freshCount = 0;
        if (page > 1) {
            try {
                freshCount = await processOpenLibraryPage(db, 1, search, limit, log);
                if (freshCount > 0) log.info(`Freshness: ${freshCount} new books`);
            } catch (err: any) {
                log.warn(`Freshness pass failed: ${err.message}`);
            }
        }

        // Deep pass: continue from stored page
        const deepCount = await processOpenLibraryPage(db, page, search, limit, log);
        await setOffset(KEY, page + 1, databaseUrl);
        return deepCount + freshCount;
    } catch (error: any) {
        log.error(`Open Library Import Error: ${error.message}`);
        throw error;
    }
}
