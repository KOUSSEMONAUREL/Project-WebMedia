import { getNeonDb } from '../db/singleton';
import { medias } from '../db/neon/schema';
import { eq, sql } from 'drizzle-orm';

const INDEXNOW_KEY = '7c3a5f8e1d924b7a9e6c0f5d8a4b2c1e';
const SITE = 'https://www.webmediia.cfd';

const typeSlug: Record<string, string> = {
    film: 'films', serie: 'series', anime: 'animes',
    jeu: 'games', webtoon: 'webtoons', comic: 'comics',
    book: 'books', novel: 'novels',
};

export async function submitAllUrls(env: any) {
    const neon = getNeonDb(env.NEON_DATABASE_URL, env.HYPERDRIVE);

    let rows: any[] = [];
    try {
        rows = await neon.select({
            slug: medias.slug,
            type: medias.type,
        })
            .from(medias)
            .where(sql`${medias.slug} IS NOT NULL`);
    } catch (e: any) {
        console.error('[IndexNow] Erreur requete medias:', e.message);
        return { submitted: 0, error: e.message };
    }

    const urlList: string[] = [];
    for (const row of rows) {
        if (!row.slug || !row.type) continue;
        const prefix = typeSlug[row.type] || row.type;
        urlList.push(`${SITE}/${prefix}/${row.slug}`);
    }

    // Ajouter les pages statiques principales
    const staticPages = ['/', '/films', '/series', '/animes', '/games', '/books', '/novels', '/comics', '/webtoons', '/trending', '/genres'];
    for (const p of staticPages) {
        urlList.unshift(`${SITE}${p}`);
    }

    if (urlList.length === 0) {
        console.log('[IndexNow] Aucune URL a soumettre');
        return { submitted: 0 };
    }

    // Soumettre par lots de 10 000 (limite IndexNow)
    const batchSize = 10000;
    let totalSubmitted = 0;

    for (let i = 0; i < urlList.length; i += batchSize) {
        const batch = urlList.slice(i, i + batchSize);
        try {
            const res = await fetch('https://api.indexnow.org/IndexNow', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                body: JSON.stringify({
                    host: 'www.webmediia.cfd',
                    key: INDEXNOW_KEY,
                    keyLocation: `${SITE}/${INDEXNOW_KEY}.txt`,
                    urlList: batch,
                }),
            });

            if (res.ok) {
                totalSubmitted += batch.length;
                console.log(`[IndexNow] Batch ${Math.floor(i / batchSize) + 1}: ${batch.length} URLs OK`);
            } else {
                console.error(`[IndexNow] Batch ${Math.floor(i / batchSize) + 1} echoue: ${res.status} ${await res.text()}`);
            }
        } catch (e: any) {
            console.error('[IndexNow] Erreur requete:', e.message);
        }
    }

    console.log(`[IndexNow] Total: ${totalSubmitted}/${urlList.length} URLs soumises`);
    return { submitted: totalSubmitted, total: urlList.length };
}
