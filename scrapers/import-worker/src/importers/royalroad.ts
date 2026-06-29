import { RoyalRoadAPI } from '@fsoc/royalroadl-api';
import { createDbClient } from '../db/client.js';
import { medias, liens } from '../db/neon/schema.js';
import { eq, inArray } from 'drizzle-orm';
import axios from 'axios';
import { batchCheckExisting, notifyBrain, notifyBrainBatch } from '../utils/batch-import.js';
import { getOffset, setOffset } from '../utils/offset-tracker.js';

const RR_BASE = 'https://www.royalroad.com';
const RR_API = new RoyalRoadAPI();
const RR_KEY = 'royalroad-page';
const INTERNAL_API_URL = process.env.INTERNAL_API_URL || (process.env.ENVIRONMENT === 'development' ? 'http://localhost:8787/api/internal' : 'https://api.webmedia.com/api/internal');
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

export async function importRoyalRoad(databaseUrl: string, limit: number = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    console.log(`🚀 Starting RoyalRoad Import (limit=${limit})...`);

    try {
        const page = await getOffset(RR_KEY, databaseUrl, 1);
        const { data } = await RR_API.fictions.getPopular(page);
        if (!data || data.length === 0) {
            console.log('📄 Fin catalogue RoyalRoad, retour page 1');
            await setOffset(RR_KEY, 1, databaseUrl);
            return 0;
        }

        const candidates = data.slice(0, limit);
        const externalIds = candidates.map((f: any) => `rr-${f.id}`);

        const existing = await batchCheckExisting(db, medias.externalId, externalIds);
        const toInsert = candidates.filter((f: any) => !existing.has(`rr-${f.id}`));

        if (toInsert.length === 0) {
            console.log(`📄 RoyalRoad page ${page}: tout existant déjà`);
            await setOffset(RR_KEY, page + 1, databaseUrl);
            return 0;
        }

        const mediaValues = toInsert.map((fiction: any) => {
            const externalId = `rr-${fiction.id}`;
            const title = fiction.title;
            const slug = `rr-${fiction.id}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.substring(0, 490);
            const author = fiction.author || 'Unknown';
            return {
                type: 'novel', title, originalTitle: title, slug, author,
                synopsis: fiction.description?.slice(0, 2000),
                posterUrl: fiction.image || undefined,
                metadataSource: 'royalroad', metadataFreshAt: new Date(), externalId,
            };
        });

        const inserted = await db.insert(medias).values(mediaValues).onConflictDoNothing().returning({ id: medias.id, externalId: medias.externalId });

        const extToId = new Map(inserted.map(m => [m.externalId, m.id]));

        const lienValues: any[] = [];
        for (const fiction of toInsert) {
            const externalId = `rr-${fiction.id}`;
            const mediaId = extToId.get(externalId);
            if (!mediaId) continue;
            lienValues.push({ mediaId, sourceSite: 'royalroad', url: `${RR_BASE}/fiction/${fiction.id}`, quality: 'original', language: 'EN' });
        }

        if (lienValues.length > 0) {
            await db.insert(liens).values(lienValues).onConflictDoNothing().catch(() => {});
        }

        const brainItems = inserted.map(m => ({ id: m.id, type: 'novel' as const }));
        await notifyBrainBatch(brainItems, INTERNAL_API_URL, INTERNAL_API_KEY);

        await setOffset(RR_KEY, page + 1, databaseUrl);

        for (const m of inserted) {
            console.log(`✅ [RR] ${m.externalId}`);
        }

        console.log(`✅ RoyalRoad import terminé : ${inserted.length} nouveaux (page ${page})`);
        return inserted.length;
    } catch (error: any) {
        console.error('❌ RoyalRoad Import Error:', error.message);
        throw error;
    }
}
