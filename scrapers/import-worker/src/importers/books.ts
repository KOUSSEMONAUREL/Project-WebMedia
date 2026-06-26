import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias, liens } from '../db/neon/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { batchCheckExisting, notifyBrainBatch, withRetry } from '../utils/batch-import.js';
import { getOffset, setOffset } from '../utils/offset-tracker.js';

const GOOGLE_BOOKS_URL = 'https://www.googleapis.com/books/v1/volumes';
const KEY = 'googlebooks';
const PER_CATEGORY = 5;
const MAX_CATEGORY_LIMIT = 5;

export async function importPopularBooks(apiKey: string, databaseUrl: string, internalApiUrl: string | null = null, internalApiKey: string | null = null, limit: number = PER_CATEGORY) {
    limit = Math.min(limit, MAX_CATEGORY_LIMIT);
    const db = createDbClient(databaseUrl, 'neon');
    const categories = ['fiction', 'fantasy', 'thriller', 'romance', 'science fiction'];
    console.log(`🚀 Starting Google Books Import (limit=${limit})...`);

    for (const cat of categories) {
        try {
            const startIndex = await getOffset(`${KEY}:${cat}`, databaseUrl, 0);
            console.log(`🔍 ${cat} (startIndex=${startIndex})`);

            const response = await withRetry(() => axios.get(GOOGLE_BOOKS_URL, {
                params: { q: `subject:${cat}`, orderBy: 'newest', maxResults: limit, startIndex, key: apiKey, langRestrict: 'fr' }
            }));

            const items = response.data.items || [];
            if (items.length === 0) {
                await setOffset(`${KEY}:${cat}`, 0, databaseUrl);
                continue;
            }

            const externalIds = items.map((i: any) => `googlebooks-${i.id}`);
            const existing = await batchCheckExisting(db, medias.externalId, externalIds);

            const toInsert = items.filter((i: any) => !existing.has(`googlebooks-${i.id}`));
            if (toInsert.length === 0) {
                console.log(`📄 ${cat}: tout existant déjà`);
                await setOffset(`${KEY}:${cat}`, startIndex + limit, databaseUrl);
                continue;
            }

            const mediaValues = toInsert.map((item: any) => {
                const info = item.volumeInfo;
                const title = info.title;
                const externalId = `googlebooks-${item.id}`;
                return {
                    type: 'book', title, originalTitle: info.title,
                    slug: `book-${externalId}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.substring(0, 490),
                    synopsis: info.description, year: info.publishedDate ? parseInt(info.publishedDate.split('-')[0]) : null,
                    posterUrl: info.imageLinks?.thumbnail, externalId,
                    metadataSource: 'google-books', metadataFreshAt: new Date()
                };
            });

            const inserted = await db.insert(medias).values(mediaValues).onConflictDoNothing().returning({ id: medias.id, externalId: medias.externalId });

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

            const brainItems = inserted.map(m => ({ id: m.id, type: 'book' as const }));
            await notifyBrainBatch(brainItems, internalApiUrl!, internalApiKey!);

            for (const m of inserted) {
                console.log(`✅ [BOOK] ${m.externalId}`);
            }

            await setOffset(`${KEY}:${cat}`, startIndex + limit, databaseUrl);
            console.log(`✅ Google Books ${cat}: ${inserted.length} ajoutés`);
        } catch (err: any) {
            console.error(`Google Books Error for ${cat}:`, err.message);
        }
    }
}
