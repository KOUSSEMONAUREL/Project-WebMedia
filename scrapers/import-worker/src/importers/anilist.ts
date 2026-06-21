import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias, liens } from '../db/neon/schema.js';
import { eq } from 'drizzle-orm';
import { generateEmbeds } from '../utils/embed-generator.js';

async function pool(tasks: (() => Promise<any>)[], concurrency: number) {
    const results: any[] = [];
    const executing: Promise<any>[] = [];
    for (const task of tasks) {
        const p = task();
        results.push(p);
        if (concurrency <= tasks.length) {
            const e: any = p.then(() => executing.splice(executing.indexOf(e), 1));
            executing.push(e);
            if (executing.length >= concurrency) await Promise.race(executing);
        }
    }
    return Promise.all(results);
}

export async function importAniList(databaseUrl: string, type: 'ANIME' | 'MANGA', format: string | null = null, internalApiUrl: string | null = null, internalApiKey: string | null = null, pages: number = 2) {
    const db = createDbClient(databaseUrl, 'neon');
    console.log(`🚀 Starting AniList Import (${type} - ${format || 'ALL'})...`);

    const query = `query ($page: Int, $type: MediaType, $format: MediaFormat, $sort: [MediaSort]) { Page(page: $page, perPage: 50) { media(type: $type, format: $format, sort: $sort) { id title { romaji english native } description startDate { year } coverImage { extraLarge } bannerImage averageScore status } } }`;

    const sorts = ['POPULARITY_DESC', 'TRENDING_DESC'];

    for (const sort of sorts) {
        for (let page = 1; page <= pages; page++) {
            try {
                const response = await axios.post('https://graphql.anilist.co', { query, variables: { page, type, format, sort: [sort] } });
                const mediaList = response.data.data?.Page?.media;
                if (!mediaList) continue;

                const tasks = mediaList.map((a: any) => async () => {
                    try {
                        const existing = await db.select().from(medias).where(eq(medias.anilistId, a.id)).limit(1);
                        if (existing.length > 0) return;

                        const title = a.title.english || a.title.romaji || a.title.native;
                        const mediaType = format === 'NOVEL' ? 'novel' : type.toLowerCase();

                        const [media] = await db.insert(medias).values({
                            anilistId: a.id,
                            type: mediaType as any,
                            title: title,
                            originalTitle: a.title.native,
                            slug: `${mediaType}-${a.id}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.substring(0, 490),
                            synopsis: a.description,
                            year: a.startDate?.year,
                            posterUrl: a.coverImage?.extraLarge,
                            backdropUrl: a.bannerImage,
                            rating: a.averageScore ? (a.averageScore / 10).toString() : "0",
                            status: a.status,
                            metadataSource: 'anilist',
                            metadataFreshAt: new Date()
                        }).onConflictDoNothing().returning();

                        if (media && type === 'ANIME') {
                            // GÉNÉRATION DÉTERMINISTE DES LIENS
                            const embeds = generateEmbeds('anime', a.id.toString(), 1, 1);
                            
                            await db.insert(liens).values(embeds.map((e: any) => ({
                                mediaId: media.id,
                                sourceSite: e.site,
                                playerHost: e.site,
                                url: e.url,
                                quality: e.quality,
                                language: 'VOSTFR'
                            })));
                        }

                        // 📡 NOTIFIER LE CERVEAU (D1)
                        if (media && internalApiUrl && internalApiKey) {
                            try {
                                await axios.post(`${internalApiUrl}/ingest/media`, {
                                    id: media.id,
                                    type: mediaType as any,
                                    metadata_ok: 1
                                }, {
                                    headers: { 'X-Internal-API-Key': internalApiKey }
                                });
                            } catch (e: any) {
                                console.error(`⚠️ Failed to notify Brain for ${title}: ${e.message}`);
                            }
                        }

                        console.log(`✅ [${mediaType.toUpperCase()}] Imported: ${title}`);
                    } catch (err) { }
                });

                await pool(tasks, 5);
                await new Promise(r => setTimeout(r, 1000)); // Rate limit safety
            } catch (err: any) {
                if (err.response?.status === 429) {
                    console.warn("AniList Rate Limit hit. Waiting...");
                    await new Promise(r => setTimeout(r, 15000));
                }
            }
        }
    }
}
