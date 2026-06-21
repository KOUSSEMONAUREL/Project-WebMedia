import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias, liens } from '../db/neon/schema.js';
import { eq, and, ilike } from 'drizzle-orm';

const GOOGLE_BOOKS_URL = 'https://www.googleapis.com/books/v1/volumes';

function normalizeTitle(title: string): string {
  return title.toLowerCase().trim().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

function buildSlug(externalId: string, title: string): string {
  return `novel-${externalId}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.substring(0, 490);
}

export async function importPopularBooks(apiKey: string, databaseUrl: string, internalApiUrl: string | null = null, internalApiKey: string | null = null) {
    const db = createDbClient(databaseUrl, 'neon');
    const categories = ['fiction', 'fantasy', 'thriller', 'romance', 'science fiction'];

    console.log("🚀 Starting Google Books Import...");

    for (const cat of categories) {
        try {
            console.log(`🔍 Searching Books in: ${cat}`);
            const response = await axios.get(GOOGLE_BOOKS_URL, {
                params: {
                    q: `subject:${cat}`,
                    orderBy: 'newest',
                    maxResults: 20,
                    key: apiKey,
                    langRestrict: 'fr'
                }
            });

            if (!response.data.items) continue;

            for (const item of response.data.items) {
                const info = item.volumeInfo;
                const externalId = item.id;
                const title = info.title;
                const authors = info.authors || [];
                const firstAuthor = authors[0] || '';

                try {
                    // Dédup par externalId (Google Books volume ID)
                    const existing = await db.select().from(medias).where(eq(medias.externalId, externalId)).limit(1);
                    if (existing.length > 0) continue;

                    const [inserted] = await db.insert(medias).values({
                        type: 'novel',
                        title,
                        originalTitle: info.title,
                        slug: buildSlug(externalId, title),
                        synopsis: info.description,
                        year: info.publishedDate ? parseInt(info.publishedDate.split('-')[0]) : null,
                        posterUrl: info.imageLinks?.thumbnail,
                        metadataSource: 'google-books',
                        metadataFreshAt: new Date(),
                        externalId,
                    }).onConflictDoNothing().returning();

                    if (!inserted) continue;

                    const bookUrl = info.previewLink || info.infoLink;
                    if (bookUrl) {
                      await db.insert(liens).values({
                        mediaId: inserted.id, sourceSite: 'google-books',
                        url: bookUrl, quality: 'original', language: 'FR',
                      }).onConflictDoNothing().catch(() => {});
                    }

                    if (internalApiUrl && internalApiKey) {
                      try {
                          await axios.post(`${internalApiUrl}/ingest/media`, {
                              id: inserted.id, type: 'novel', metadata_ok: 1
                          }, {
                              headers: { 'X-Internal-API-Key': internalApiKey }, timeout: 5000,
                          });
                      } catch (err) {
                          console.error(`Failed to sync imported book ${inserted.id} to internal API: ${err instanceof Error ? err.message : err}`);
                      }
                    }

                    console.log(`✅ [NOVEL] Imported: ${title}`);

                } catch (err) { /* skip item */ }
            }
        } catch (err: any) {
            console.error(`Google Books Error for ${cat}: `, err.message);
        }
    }
}
