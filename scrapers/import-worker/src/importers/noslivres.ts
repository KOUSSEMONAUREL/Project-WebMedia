import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias, liens } from '../db/neon/schema.js';
import { batchCheckExisting, notifyBrain, withRetry } from '../utils/batch-import.js';
import { getOffset, setOffset } from '../utils/offset-tracker.js';
import crypto from 'crypto';
import fs from 'fs';

const API = 'https://noslivres.net/query.php';
const KEY = 'noslivres';
const CACHE_FILE = '/tmp/noslivres_catalog.json';
const CACHE_TTL = 24 * 3600 * 1000;

function extractUrl(html: string): string {
    const m = html.match(/href='([^']+)'/);
    return m ? m[1] : '';
}

function extractSource(html: string): string {
    const m = html.match(/>([^<]+)<\/a>/);
    return m ? m[1].trim() : 'noslivres';
}

async function fetchCatalog(): Promise<string[][]> {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const stat = fs.statSync(CACHE_FILE);
            if (Date.now() - stat.mtimeMs < CACHE_TTL) {
                const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
                console.log(`📦 Catalogue NosLivres lu depuis cache (${cached.length} entrées)`);
                return cached;
            }
        }
    } catch {}

    console.log('📡 Téléchargement du catalogue NosLivres (26k livres)...');
    const response = await withRetry(() => axios.post(API,
        'draw=1&start=0&length=26410&columns[0][data]=0&columns[1][data]=1&columns[2][data]=2&columns[3][data]=3&columns[4][data]=4',
        { headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 60000 }
    ));
    const rows: string[][] = response.data.data ?? [];
    console.log(`📦 Catalogue reçu: ${rows.length} entrées (${response.data.recordsTotal} total)`);

    try { fs.writeFileSync(CACHE_FILE, JSON.stringify(rows)); } catch {}
    return rows;
}

export async function importPopularBooksFR(databaseUrl: string, limit: number = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    console.log(`🚀 Starting NosLivres Import (limit=${limit})...`);

    try {
        const rows = await fetchCatalog();
        if (rows.length === 0) {
            console.log('📄 Catalogue NosLivres vide');
            return 0;
        }

        const start = await getOffset(KEY, databaseUrl, 0);
        const batch = rows.slice(start, start + limit);

        if (batch.length === 0) {
            await setOffset(KEY, 0, databaseUrl);
            console.log(`📄 Catalogue NosLivres complet (${rows.length} entrées), retour début`);
            return 0;
        }

        const externalIds = batch.map((r: string[]) => {
            const url = extractUrl(r[4]);
            return `nl-${crypto.createHash('md5').update(url).digest('hex').slice(0, 12)}`;
        });
        const existing = await batchCheckExisting(db, medias.externalId, externalIds);

        let importedCount = 0;
        for (let i = 0; i < batch.length; i++) {
            const [titre, auteur, parution, maj, urlHtml] = batch[i];
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

        const nextStart = start + batch.length;
        if (nextStart >= rows.length) {
            await setOffset(KEY, 0, databaseUrl);
            console.log(`📄 Catalogue NosLivres complet (${rows.length} entrées), retour début`);
        } else {
            await setOffset(KEY, nextStart, databaseUrl);
        }

        console.log(`✅ NosLivres: ${importedCount} ajoutés (offset ${start}/${rows.length})`);
        return importedCount;
    } catch (error: any) {
        console.warn('⚠️ NosLivres ignoré (API inaccessible):', error.message);
        return 0;
    }
}