import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias, liens } from '../db/neon/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { batchCheckExisting, notifyBrainBatch, withRetry } from '../utils/batch-import.js';
import { getOffset, setOffset } from '../utils/offset-tracker.js';
import { createLog } from '../utils/log.js';

const GOOGLE_BOOKS_URL = 'https://www.googleapis.com/books/v1/volumes';
const KEY = 'googlebooks';
const PER_CATEGORY = 5;
const MAX_CATEGORY_LIMIT = 5;

async function processBooksCategory(apiKey: string, cat: string, startIndex: number, limit: number, db: any, log: ReturnType<typeof createLog>, internalApiUrl: string | null, internalApiKey: string | null): Promise<number> {
    const response = await withRetry(() => axios.get(GOOGLE_BOOKS_URL, {
        params: { q: `subject:${cat}`, orderBy: 'newest', maxResults: limit, startIndex, key: apiKey, langRestrict: 'fr' }
    }));

    const items = response.data.items || [];
    if (items.length === 0) return 0;

    const externalIds = items.map((i: any) => `googlebooks-${i.id}`);
    const existing = await batchCheckExisting(db, medias.externalId, externalIds);

    const toInsert = items.filter((i: any) => !existing.has(`googlebooks-${i.id}`));
    if (toInsert.length === 0) {
        log.skip(`${cat}: all existing`);
        return 0;
    }

    const mediaValues = toInsert.map((item: any) => {
        const info = item.volumeInfo || {};
        const title = (info.title || 'Titre inconnu').substring(0, 490);
        const externalId = `googlebooks-${item.id}`;
        const author = (info.authors ? info.authors.join(', ') : 'Unknown').substring(0, 290);
        const isbn = (info.industryIdentifiers || [])
            .map((id: any) => id.identifier)
            .join(', ');
        return {
            type: 'book', title, originalTitle: info.title, author,
            slug: `book-${externalId}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.substring(0, 490),
            synopsis: info.description,
            year: info.publishedDate ? parseInt(info.publishedDate.split('-')[0]) : null,
            posterUrl: info.imageLinks?.thumbnail,
            rating: info.averageRating ? String(info.averageRating) : undefined,
            voteCount: info.ratingsCount || 0,
            genres: info.categories?.length ? JSON.stringify(info.categories) : undefined,
            studios: info.publisher ? JSON.stringify([info.publisher]) : undefined,
            duration: info.pageCount || undefined,
            externalId,
            metadataSource: 'google-books', metadataFreshAt: new Date(),
        };
    });

    const inserted: any[] = await db.insert(medias).values(mediaValues).onConflictDoNothing().returning({ id: medias.id, externalId: medias.externalId, title: medias.title, slug: medias.slug });

    const extToId = new Map(inserted.map(m => [m.externalId, m.id]));

    const lienValues: any[] = [];
    for (const item of toInsert) {
        const info = (item as any).volumeInfo;
        const bookUrl = info.previewLink || info.infoLink;
        const mediaId = extToId.get(`googlebooks-${item.id}`);
        if (!mediaId || !bookUrl) continue;
        lienValues.push({ mediaId, sourceSite: 'google-books', url: bookUrl, quality: 'original', language: 'FR' });
    }

    if (lienValues.length > 0) {
        await db.insert(liens).values(lienValues).onConflictDoNothing().catch(() => {});
    }

    const brainItems = inserted.map(m => ({ id: m.id, type: 'book' as const, title: m.title, slug: m.slug }));
    await notifyBrainBatch(brainItems, internalApiUrl!, internalApiKey!);

    for (const m of inserted) {
        log.success(`[BOOK] ${m.externalId}`);
    }

    log.success(`Google Books ${cat}: ${inserted.length} added`);
    return inserted.length;
}

export async function importPopularBooks(apiKey: string, databaseUrl: string, internalApiUrl: string | null = null, internalApiKey: string | null = null, limit: number = PER_CATEGORY) {
    limit = Math.min(limit, MAX_CATEGORY_LIMIT);
    const db = createDbClient(databaseUrl, 'neon');
    const log = createLog('Google Books', 'one-shot');
    log.start(`Import (limit=${limit})`);

    const categories = ['fiction', 'fantasy', 'thriller', 'romance', 'science fiction'];

    for (const cat of categories) {
        try {
            const startIndex = await getOffset(`${KEY}:${cat}`, databaseUrl, 0);
            log.info(`${cat} (startIndex=${startIndex})`);

            // Freshness pass: always check startIndex=0 for newest books
            if (startIndex > 0) {
                try {
                    const freshCount = await processBooksCategory(apiKey, cat, 0, limit, db, log, internalApiUrl, internalApiKey);
                    if (freshCount > 0) log.info(`Freshness: ${freshCount} new for ${cat}`);
                } catch (err: any) {
                    log.warn(`Freshness pass failed for ${cat}: ${err.message}`);
                }
            }

            // Deep pass: continue from stored startIndex
            const deepCount = await processBooksCategory(apiKey, cat, startIndex, limit, db, log, internalApiUrl, internalApiKey);
            await setOffset(`${KEY}:${cat}`, startIndex + limit, databaseUrl);
        } catch (err: any) {
            log.error(`Google Books Error for ${cat}: ${err.message}`);
        }
    }
}
