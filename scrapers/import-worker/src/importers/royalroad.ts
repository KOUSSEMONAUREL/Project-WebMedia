import { RoyalRoadAPI } from '@fsoc/royalroadl-api';
import { createDbClient } from '../db/client.js';
import { medias, liens } from '../db/neon/schema.js';
import { eq } from 'drizzle-orm';
import axios from 'axios';

const RR_BASE = 'https://www.royalroad.com';
const RR_API = new RoyalRoadAPI();
const INTERNAL_API_URL = process.env.INTERNAL_API_URL || (process.env.ENVIRONMENT === 'development' ? 'http://localhost:8787/api/internal' : 'https://api.webmedia.com/api/internal');
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

export async function importRoyalRoad(databaseUrl: string) {
    const db = createDbClient(databaseUrl, 'neon');

    console.log('🚀 Starting RoyalRoad Import...');

    try {
        const { data } = await RR_API.fictions.getPopular();
        if (!data || data.length === 0) {
            console.log('⚠️ Aucune fiction trouvée sur RoyalRoad');
            return 0;
        }

        let importedCount = 0;

        for (const fiction of data) {
            const externalId = `rr-${fiction.id}`;
            const title = fiction.title;
            const slug = `rr-${fiction.id}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.substring(0, 490);
            const url = `${RR_BASE}/fiction/${fiction.id}`;

            try {
                // Dédup par externalId
                const existing = await db.select().from(medias).where(eq(medias.externalId, externalId)).limit(1);
                if (existing.length > 0) continue;

                const [inserted] = await db.insert(medias).values({
                    type: 'novel',
                    title,
                    originalTitle: title,
                    slug,
                    synopsis: fiction.description?.slice(0, 2000),
                    posterUrl: fiction.image || undefined,
                    metadataSource: 'royalroad',
                    metadataFreshAt: new Date(),
                    externalId,
                }).onConflictDoNothing().returning();

                if (!inserted) continue;

                // Lien direct RoyalRoad déjà connu
                await db.insert(liens).values({
                    mediaId: inserted.id,
                    sourceSite: 'royalroad',
                    url,
                    quality: 'original',
                    language: 'EN',
                }).onConflictDoNothing().catch(() => {});

                if (INTERNAL_API_URL && INTERNAL_API_KEY) {
                    try {
                        await axios.post(`${INTERNAL_API_URL}/ingest/media`, {
                            id: inserted.id, type: 'novel', metadata_ok: 1
                        }, {
                            headers: { 'X-Internal-API-Key': INTERNAL_API_KEY }, timeout: 5000,
                        });
                    } catch (err) {
                        console.error(`Failed to sync media ${inserted.id} to internal API: ${err instanceof Error ? err.message : err}`);
                    }
                }

                importedCount++;
                console.log(`✅ [RR] ${title}`);

            } catch (err) {
                console.error(`Failed to import fiction ${fiction?.id}: ${err instanceof Error ? err.message : err}`);
            }
        }

        console.log(`✅ RoyalRoad import terminé : ${importedCount} nouveaux`);
        return importedCount;
    } catch (error: any) {
        console.error('❌ RoyalRoad Import Error:', error.message);
        throw error;
    }
}
