import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias, liens } from '../db/neon/schema.js';
import { eq } from 'drizzle-orm';
import { generateEmbeds } from '../utils/embed-generator.js';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

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

export async function importTrending(apiKey: string, databaseUrl: string, internalApiUrl: string, internalApiKey: string, pages: number = 1) {
    const db = createDbClient(databaseUrl, 'neon');
    console.log(`🚀 Starting Turbo TMDB Import (${pages} pages)...`);

    for (let page = 1; page <= pages; page++) {
        try {
            const movieRes = await axios.get(`${TMDB_BASE_URL}/movie/popular`, { params: { api_key: apiKey, page, language: 'fr-FR' } });
            const tvRes = await axios.get(`${TMDB_BASE_URL}/tv/popular`, { params: { api_key: apiKey, page, language: 'fr-FR' } });

            const allItems = [
                ...movieRes.data.results.map((m: any) => ({ id: m.id, type: 'movie' })),
                ...tvRes.data.results.map((t: any) => ({ id: t.id, type: 'tv' }))
            ];

            const tasks = allItems.map(item => async () => {
                try {
                    const existing = await db.select().from(medias).where(eq(medias.tmdbId, item.id)).limit(1);
                    if (existing.length > 0) return;

                    const detail = await axios.get(`${TMDB_BASE_URL}/${item.type}/${item.id}`, { params: { api_key: apiKey, language: 'fr-FR' } });
                    const d = detail.data;
                    const title = d.title || d.name;

                    const [media] = await db.insert(medias).values({
                        tmdbId: item.id,
                        type: item.type === 'movie' ? 'film' : 'serie',
                        title: title,
                        originalTitle: d.original_title || d.original_name,
                        slug: `${item.type}-${item.id}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.substring(0, 490),
                        synopsis: d.overview,
                        year: (d.release_date || d.first_air_date || '').split('-')[0] || null,
                        posterUrl: d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : null,
                        backdropUrl: d.backdrop_path ? `https://image.tmdb.org/t/p/original${d.backdrop_path}` : null,
                        rating: d.vote_average ? d.vote_average.toString() : "0",
                        status: d.status,
                        metadataSource: 'tmdb',
                        metadataFreshAt: new Date()
                    }).onConflictDoNothing().returning();

                    if (media) {
                        // GÉNÉRATION DÉTERMINISTE DES LIENS
                        const embeds = generateEmbeds(item.type === 'movie' ? 'movie' : 'tv', item.id.toString(), 1, 1);
                        
                        await db.insert(liens).values(embeds.map(e => ({
                            mediaId: media.id,
                            sourceSite: e.site,
                            playerHost: e.site,
                            url: e.url,
                            quality: e.quality,
                            language: 'VFF/VOSTFR'
                        })));

                        // 📡 NOTIFIER LE CERVEAU (D1)
                        if (internalApiUrl && internalApiKey) {
                            try {
                                await axios.post(`${internalApiUrl}/ingest/media`, {
                                    id: media.id,
                                    type: item.type === 'movie' ? 'film' : 'serie',
                                    metadata_ok: 1
                                }, {
                                    headers: { 'X-Internal-API-Key': internalApiKey }
                                });
                            } catch (e: any) {
                                console.error(`⚠️ Failed to notify Brain for ${title}: ${e.message}`);
                            }
                        }

                        console.log(`✅ [${item.type.toUpperCase()}] Imported: ${title}`);
                    }
                } catch (err) { }
            });

            await pool(tasks, 10);
        } catch (err) {
            console.error(`Error on TMDB page ${page}`);
        }
    }
    console.log("🏁 TMDB Turbo Import finished.");
}
