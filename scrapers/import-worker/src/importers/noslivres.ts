import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias, liens } from '../db/neon/schema.js';
import { batchCheckExisting, notifyBrain, withRetry } from '../utils/batch-import.js';
import { getOffset, setOffset } from '../utils/offset-tracker.js';
import crypto from 'crypto';

const API = 'https://noslivres.net/query.php';
const KEY = 'noslivres';

function extractUrl(html: string | undefined): string {
    if (!html) return '';
    const m = html.match(/href='([^']+)'/);
    return m ? m[1] : '';
}

function extractSource(html: string | undefined): string {
    if (!html) return 'noslivres';
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
            const [titre, auteur, , , urlHtml] = r;
            const url = extractUrl(urlHtml);
            const raw = `${titre ?? ''}|${auteur ?? ''}|${url}`;
            return `nl-${crypto.createHash('md5').update(raw).digest('hex').slice(0, 12)}`;
        });
        const existing = await batchCheckExisting(db, medias.externalId, externalIds);

        const toInsert: { row: string[]; externalId: string; title: string; url: string; source: string; slug: string }[] = [];
        for (let i = 0; i < rows.length; i++) {
            const [titre, auteur, parution, maj, urlHtml] = rows[i];
            const externalId = externalIds[i];
            if (existing.has(externalId)) continue;

            const url = extractUrl(urlHtml);
            const source = extractSource(urlHtml);
            const title = titre || 'Titre inconnu';
            const slug = `nl-${externalId}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.substring(0, 490);

            toInsert.push({ row: rows[i], externalId, title, url, source, slug });
        }

        if (toInsert.length === 0) {
            console.log(`📄 NosLivres offset ${start}: tout existant déjà`);
            const nextStart = start + rows.length;
            if (nextStart >= total) {
                await setOffset(KEY, 0, databaseUrl);
            } else {
                await setOffset(KEY, nextStart, databaseUrl);
            }
            return 0;
        }

        const mediaValues = toInsert.map(item => ({
            type: 'book', title: item.title, slug: item.slug, externalId: item.externalId,
            author: item.row[1] || 'Unknown',
            year: item.row[2] ? parseInt(item.row[2].split('-')[0]) : undefined,
            metadataSource: 'noslivres', metadataFreshAt: new Date()
        }));

        const inserted = await db.insert(medias).values(mediaValues).onConflictDoNothing().returning({ id: medias.id, externalId: medias.externalId });

        const extToId = new Map(inserted.map(m => [m.externalId, m.id]));

        const lienValues: any[] = [];
        for (const item of toInsert) {
            if (!item.url) continue;
            const mediaId = extToId.get(item.externalId);
            if (!mediaId) continue;
            lienValues.push({ mediaId, sourceSite: (item.source || 'noslivres').toLowerCase(), url: item.url, quality: 'original', language: 'FR' });
        }

        if (lienValues.length > 0) {
            await db.insert(liens).values(lienValues).onConflictDoNothing().catch(() => {});
        }

        for (const m of inserted) {
            try {
                await notifyBrain(m.id, 'book', process.env.INTERNAL_API_URL!, process.env.INTERNAL_API_KEY!);
            } catch { /* ignore brain errors */ }
        }

        console.log(`✅ NosLivres: ${inserted.length} ajoutés (offset ${start}/${total})`);

        const nextStart = start + rows.length;
        if (nextStart >= total) {
            await setOffset(KEY, 0, databaseUrl);
            console.log(`📄 Catalogue NosLivres complet (${total} entrées), retour début`);
        } else {
            await setOffset(KEY, nextStart, databaseUrl);
        }

        return inserted.length;
    } catch (error: any) {
        console.warn('⚠️ NosLivres ignoré (API inaccessible):', error.message);
        return 0;
    }
}
