import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias, liens } from '../db/neon/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { batchCheckExisting, notifyBrain, withRetry } from '../utils/batch-import.js';
import { getOffset, setOffset } from '../utils/offset-tracker.js';

const OPEN_LIBRARY_API = 'https://openlibrary.org';
const KEY = 'openlibrary';

export async function importOpenLibrary(databaseUrl: string, search: string = 'popular', limit: number = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    console.log(`🚀 Starting Open Library Import (search=${search}, limit=${limit})...`);

    try {
        const page = await getOffset(KEY, databaseUrl, 1);
        const response = await withRetry(() => axios.get(`${OPEN_LIBRARY_API}/search.json`, {
            params: { q: search, page, limit }
        }));

        const results = (response.data.docs || []).slice(0, limit);
        if (results.length === 0) {
            await setOffset(KEY, 1, databaseUrl);
            console.log('📄 Fin catalogue OpenLibrary, retour page 1');
            return 0;
        }

        const externalIds = results.map((item: any) => `ol-${item.key.replace('/works/', '')}`);
        const existing = await batchCheckExisting(db, medias.externalId, externalIds);

        const toInsert = results.filter((item: any) => {
            const externalId = `ol-${item.key.replace('/works/', '')}`;
            return !existing.has(externalId);
        });

        if (toInsert.length === 0) {
            console.log(`📄 OpenLibrary page ${page}: tout existant déjà`);
            await setOffset(KEY, page + 1, databaseUrl);
            return 0;
        }

        const mediaValues = toInsert.map((item: any) => {
            const externalId = `ol-${item.key.replace('/works/', '')}`;
            const title = item.title;
            const slug = `book-${externalId}-${title.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, '')}`.substring(0, 490);
            return {
                type: 'book', title, originalTitle: title,
                synopsis: item.first_sentence ? item.first_sentence[0] : '',
                posterUrl: item.cover_i ? `https://covers.openlibrary.org/b/id/${item.cover_i}-L.jpg` : undefined,
                externalId, slug, metadataSource: 'openlibrary', metadataFreshAt: new Date()
            };
        });

        const inserted = await db.insert(medias).values(mediaValues).onConflictDoNothing().returning({ id: medias.id, externalId: medias.externalId });

        const lienValues = inserted.map(m => ({
            mediaId: m.id, sourceSite: 'openlibrary',
            url: `${OPEN_LIBRARY_API}/works/${m.externalId?.replace('ol-', '')}`,
            quality: 'original', language: 'EN'
        }));

        if (lienValues.length > 0) {
            await db.insert(liens).values(lienValues).onConflictDoNothing();
        }

        for (const m of inserted) {
            await notifyBrain(m.id, 'book', process.env.INTERNAL_API_URL!, process.env.INTERNAL_API_KEY!);
        }

        console.log(`✅ OpenLibrary: ${inserted.length} ajoutés (page ${page})`);
        return inserted.length;
    } catch (error: any) {
        console.error('❌ Open Library Import Error:', error.message);
        throw error;
    }
}
