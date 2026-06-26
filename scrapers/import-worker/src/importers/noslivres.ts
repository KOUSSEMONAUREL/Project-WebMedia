import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias, liens } from '../db/neon/schema.js';
import { batchCheckExisting, notifyBrain, withRetry } from '../utils/batch-import.js';
import { getOffset, setOffset } from '../utils/offset-tracker.js';
import crypto from 'crypto';

const API = 'https://noslivres.net/query.php';
const KEY = 'noslivres';

function extractUrl(html: string): string {
    const m = html.match(/href='([^']+)'/);
    return m ? m[1] : '';
}

function extractSource(html: string): string {
    const m = html.match(/>([^<]+)<\/a>/);
    return m ? m[1].trim() : 'noslivres';
}

export async function importPopularBooksFR(databaseUrl: string, limit: number = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    console.log(`🚀 Starting NosLivres Import (limit=${limit})...`);

    try {
        const start = await getOffset(KEY, databaseUrl, 0);

        const response = await withRetry(() => axios.get(API, {
            params: { draw: 1, start, length: limit },
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
            timeout: 15000
        }));

        const total = response.data.recordsTotal ?? 0;
        const rows: string[][] = response.data.data ?? [];

        if (rows.length === 0) {
            await setOffset(KEY, 0, databaseUrl);
            console.log('📄 Fin catalogue NosLivres, retour début');
            return 0;
        }

        const externalIds = rows.map((r: string[]) => {
            const url = extractUrl(r[4]);
            return `nl-${crypto.createHash('md5').update(url).digest('hex').slice(0, 12)}`;
        });
        const existing = await batchCheckExisting(db, medias.externalId, externalIds);

        let importedCount = 0;
        for (let i = 0; i < rows.length; i++) {
            const [titre, auteur, parution, maj, urlHtml] = rows[i];
            const externalId = externalIds[i];
            if (existing.has(externalId)) continue;

            const url = extractUrl(urlHtml);
            const source = extractSource(urlHtml);
            const title = titre || 'Titre inconnu';
            const slug = `nl-${externalId}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.substring(0, 490);

            try {
                const [media] = await db.insert(medias).values({
                    type: 'book', title, slug, externalId,
                    year: parution ? parseInt(parution.split('-')[0]) : undefined,
                    metadataSource: 'noslivres', metadataFreshAt: new Date()
                }).returning({ id: medias.id });

                if (media && url) {
                    await db.insert(liens).values({
                        mediaId: media.id, sourceSite: source.toLowerCase(),
                        url, quality: 'original', language: 'FR',
                    }).onConflictDoNothing().catch(() => {});
                    importedCount++;
                }
            } catch {}
        }

        const nextStart = start + rows.length;
        if (nextStart >= total) {
            await setOffset(KEY, 0, databaseUrl);
            console.log(`📄 Catalogue NosLivres complet (${total} entrées), retour début`);
        } else {
            await setOffset(KEY, nextStart, databaseUrl);
        }

        console.log(`✅ NosLivres: ${importedCount} ajoutés (offset ${start}/${total})`);
        return importedCount;
    } catch (error: any) {
        console.warn('⚠️ NosLivres ignoré (API inaccessible):', error.message);
        return 0;
    }
}