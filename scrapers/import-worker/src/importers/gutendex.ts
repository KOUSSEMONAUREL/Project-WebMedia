import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias, liens } from '../db/neon/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { batchCheckExisting, notifyBrain } from '../utils/batch-import.js';
import { getOffset, setOffset } from '../utils/offset-tracker.js';

const GUTENDEX_API = 'https://gutendex.com/books';
const KEY = 'gutendex';

export async function importGutenberg(databaseUrl: string, limit: number = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    console.log(`🚀 Starting Gutendex Import (limit=${limit})...`);

    try {
        const page = await getOffset(KEY, databaseUrl, 1);
        const response = await axios.get(GUTENDEX_API, {
            params: { page, sort: 'popular' },
            headers: { 'User-Agent': 'WebMedia/1.0 (Metadata Import Worker)' }
        });

        const results = (response.data.results || []).slice(0, limit);
        if (results.length === 0) {
            await setOffset(KEY, 1, databaseUrl);
            console.log('📄 Fin du catalogue Gutendex, retour page 1');
            return 0;
        }

        const existing = await batchCheckExisting(db, medias.slug, results.map((r: any) =>
            `book-gb-${r.id}-${r.title?.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, '')}`.substring(0, 490)
        ));

        let importedCount = 0;
        for (const item of results) {
            const externalId = item.id.toString();
            const title = item.title;
            const slug = `book-gb-${externalId}-${title.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, '')}`.substring(0, 490);
            if (existing.has(slug)) continue;

            try {
                const [media] = await db.insert(medias).values({
                    type: 'novel', title, originalTitle: title,
                    synopsis: `Auteur(s): ${(item.authors || []).map((a: any) => a.name).join(', ')}`,
                    posterUrl: item.formats?.['image/jpeg'], externalId, slug,
                    metadataSource: 'gutenberg', metadataFreshAt: new Date()
                }).returning({ id: medias.id });

                if (media) {
                    const readUrl = item.formats?.['application/epub+zip'] || item.formats?.['text/html'];
                    if (readUrl) {
                        await db.insert(liens).values({
                            mediaId: media.id, sourceSite: 'gutenberg',
                            url: readUrl, quality: 'original',
                            language: (item.languages?.[0] || 'EN')
                        });
                    }
                    importedCount++;
                }
            } catch {}
        }

        await setOffset(KEY, page + 1, databaseUrl);
        console.log(`✅ Gutendex: ${importedCount} ajoutés (page ${page})`);
        return importedCount;
    } catch (error: any) {
        console.error('❌ Gutendex Import Error:', error.message);
        throw error;
    }
}
