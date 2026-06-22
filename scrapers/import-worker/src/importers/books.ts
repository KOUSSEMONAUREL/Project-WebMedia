import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias, liens } from '../db/neon/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { batchCheckExisting, notifyBrain } from '../utils/batch-import.js';
import { getOffset, setOffset } from '../utils/offset-tracker.js';

const GOOGLE_BOOKS_URL = 'https://www.googleapis.com/books/v1/volumes';
const KEY = 'googlebooks';
const PER_CATEGORY = 5;

export async function importPopularBooks(apiKey: string, databaseUrl: string, internalApiUrl: string | null = null, internalApiKey: string | null = null, limit: number = PER_CATEGORY) {
    const db = createDbClient(databaseUrl, 'neon');
    const categories = ['fiction', 'fantasy', 'thriller', 'romance', 'science fiction'];
    console.log(`🚀 Starting Google Books Import (limit=${limit})...`);

    let totalImported = 0;
    for (const cat of categories) {
        try {
            const startIndex = await getOffset(`${KEY}:${cat}`, databaseUrl, 0);
            console.log(`🔍 ${cat} (startIndex=${startIndex})`);

            const response = await axios.get(GOOGLE_BOOKS_URL, {
                params: { q: `subject:${cat}`, orderBy: 'newest', maxResults: limit, startIndex, key: apiKey, langRestrict: 'fr' }
            });

            const items = response.data.items || [];
            if (items.length === 0) {
                await setOffset(`${KEY}:${cat}`, 0, databaseUrl);
                continue;
            }

            const externalIds = items.map((i: any) => i.id);
            const existing = await batchCheckExisting(db, medias.externalId, externalIds);

            for (const item of items) {
                const externalId = item.id;
                if (existing.has(externalId)) continue;

                const info = item.volumeInfo;
                const title = info.title;
                try {
                    const [inserted] = await db.insert(medias).values({
                        type: 'novel', title, originalTitle: info.title,
                        slug: `novel-${externalId}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.substring(0, 490),
                        synopsis: info.description, year: info.publishedDate ? parseInt(info.publishedDate.split('-')[0]) : null,
                        posterUrl: info.imageLinks?.thumbnail, externalId,
                        metadataSource: 'google-books', metadataFreshAt: new Date()
                    }).onConflictDoNothing().returning();

                    if (!inserted) continue;

                    const bookUrl = info.previewLink || info.infoLink;
                    if (bookUrl) {
                        await db.insert(liens).values({
                            mediaId: inserted.id, sourceSite: 'google-books',
                            url: bookUrl, quality: 'original', language: 'FR',
                        }).onConflictDoNothing().catch(() => {});
                    }

                    await notifyBrain(inserted.id, 'novel', internalApiUrl!, internalApiKey!);
                    totalImported++;
                    console.log(`✅ [NOVEL] ${title}`);
                } catch {}
            }

            await setOffset(`${KEY}:${cat}`, startIndex + limit, databaseUrl);
        } catch (err: any) {
            console.error(`Google Books Error for ${cat}:`, err.message);
        }
    }

    console.log(`✅ Google Books: ${totalImported} ajoutés`);
    return totalImported;
}
