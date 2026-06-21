import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias, liens } from '../db/neon/schema.js';
import { eq } from 'drizzle-orm';

const GUTENDEX_API = 'https://gutendex.com/books';

export async function importGutenberg(databaseUrl: string) {
    const db = createDbClient(databaseUrl, 'neon');
    console.log(`🚀 Starting Gutendex (Gutenberg) Import...`);

    try {
        const response = await axios.get(GUTENDEX_API, {
            params: { sort: 'popular' },
            headers: { 'User-Agent': 'WebMedia/1.0 (Metadata Import Worker)' }
        });

        const results = response.data.results;
        let importedCount = 0;

        for (const item of results) {
            const externalId = item.id.toString();
            const title = item.title;
            const slug = `book-gb-${externalId}-${title.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, '')}`.substring(0, 490);

            const existing = await db.select().from(medias).where(eq(medias.slug, slug)).limit(1);

            if (existing.length === 0) {
                const [media] = await db.insert(medias).values({
                    type: 'novel',
                    title,
                    originalTitle: title,
                    synopsis: `Auteur(s): ${item.authors.map((a: any) => a.name).join(', ')}`,
                    posterUrl: item.formats['image/jpeg'],
                    externalId,
                    slug,
                    metadataSource: 'gutenberg',
                    metadataFreshAt: new Date()
                }).returning({ id: medias.id });

                if (media) {
                    const readUrl = item.formats['application/epub+zip'] || item.formats['text/html'];
                    if (readUrl) {
                        await db.insert(liens).values({
                            mediaId: media.id,
                            sourceSite: 'gutenberg',
                            url: readUrl,
                            quality: 'original',
                            language: item.languages[0] || 'EN'
                        });
                    }
                    importedCount++;
                }
            }
        }
        console.log(`✅ Gutendex import complete: ${importedCount} added.`);
    } catch (error: any) {
        console.error('❌ Gutendex Import Error:', error.message);
        if (error.response) console.error('   Status:', error.response.status, 'Data:', JSON.stringify(error.response.data).slice(0, 200));
    }
}
