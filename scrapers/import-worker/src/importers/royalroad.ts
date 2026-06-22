import { RoyalRoadAPI } from '@fsoc/royalroadl-api';
import { createDbClient } from '../db/client.js';
import { medias, liens } from '../db/neon/schema.js';
import { eq, inArray } from 'drizzle-orm';
import axios from 'axios';
import { batchCheckExisting, notifyBrain } from '../utils/batch-import.js';

const RR_BASE = 'https://www.royalroad.com';
const RR_API = new RoyalRoadAPI();
const INTERNAL_API_URL = process.env.INTERNAL_API_URL || (process.env.ENVIRONMENT === 'development' ? 'http://localhost:8787/api/internal' : 'https://api.webmedia.com/api/internal');
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

export async function importRoyalRoad(databaseUrl: string, limit: number = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    console.log(`🚀 Starting RoyalRoad Import (limit=${limit})...`);

    try {
        const { data } = await RR_API.fictions.getPopular();
        if (!data || data.length === 0) {
            console.log('⚠️ Aucune fiction trouvée sur RoyalRoad');
            return 0;
        }

        const candidates = data.slice(0, limit);
        const externalIds = candidates.map((f: any) => `rr-${f.id}`);

        const existing = await batchCheckExisting(db, medias.externalId, externalIds);
        const toInsert = candidates.filter((f: any) => !existing.has(`rr-${f.id}`));

        let importedCount = 0;
        for (const fiction of toInsert) {
            const externalId = `rr-${fiction.id}`;
            const title = fiction.title;
            const slug = `rr-${fiction.id}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.substring(0, 490);
            const url = `${RR_BASE}/fiction/${fiction.id}`;

            try {
                const [inserted] = await db.insert(medias).values({
                    type: 'novel', title, originalTitle: title, slug,
                    synopsis: fiction.description?.slice(0, 2000),
                    posterUrl: fiction.image || undefined,
                    metadataSource: 'royalroad', metadataFreshAt: new Date(), externalId,
                }).onConflictDoNothing().returning();

                if (!inserted) continue;

                await db.insert(liens).values({
                    mediaId: inserted.id, sourceSite: 'royalroad',
                    url, quality: 'original', language: 'EN',
                }).onConflictDoNothing().catch(() => {});

                await notifyBrain(inserted.id, 'novel', INTERNAL_API_URL, INTERNAL_API_KEY);
                importedCount++;
                console.log(`✅ [RR] ${title}`);
            } catch {}
        }

        console.log(`✅ RoyalRoad import terminé : ${importedCount} nouveaux`);
        return importedCount;
    } catch (error: any) {
        console.error('❌ RoyalRoad Import Error:', error.message);
        throw error;
    }
}
