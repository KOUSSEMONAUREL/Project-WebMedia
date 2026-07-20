import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias, liens } from '../db/neon/schema.js';
import { eq } from 'drizzle-orm';
import { batchCheckExisting, notifyBrainBatch, withRetry } from '../utils/batch-import.js';
import { runScanner } from '../utils/api-scanner.js';
import type { ScannerConfig, ProcessContext, FetchResult } from '../utils/api-scanner.js';
import type { createLog } from '../utils/log.js';
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

async function fetchOpenLibraryCoversFor(inserted: any[], toInsert: { title: string; externalId: string }[], db: any, log: ReturnType<typeof createLog>) {
    if (inserted.length === 0) return;
    const extToId = new Map(inserted.filter(m => m.externalId).map(m => [m.externalId!, m.id]));
    for (const item of toInsert) {
        const mediaId = extToId.get(item.externalId);
        if (!mediaId) continue;
        try {
            const res = await axios.get('https://openlibrary.org/search.json', {
                params: { q: item.title, limit: 5 },
                timeout: 8000,
            });
            const docs = res.data.docs || [];
            const best = docs.find((d: any) => d.title && d.title.toLowerCase() === item.title.toLowerCase()) || docs[0];
            const coverI = best?.cover_i;
            if (coverI) {
                const coverUrl = `https://covers.openlibrary.org/b/id/${coverI}-L.jpg`;
                await db.update(medias).set({ posterUrl: coverUrl }).where(eq(medias.id, mediaId));
                log.info(`Cover found for "${item.title}"`);
            }
        } catch { /* ignore */ }
    }
}

export async function importPopularBooksFR(databaseUrl: string, limit: number = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    const ctx: ProcessContext = { db, databaseUrl };

    const config: ScannerConfig = {
        key: KEY,
        name: 'NosLivres',
        rateLimit: { requestsPerSecond: 2, maxConcurrent: 1 },
        freshness: {
            maxHistoryDays: 3,
            defaultCheckpointAgeMs: 3600 * 1000,
            fetch: async (fetchLimit: number, _checkpoint: string) => {
                const response = await withRetry(() => axios.get(API, {
                    params: { draw: 1, start: 0, length: fetchLimit },
                    headers: { 'X-Requested-With': 'XMLHttpRequest' },
                    timeout: 15000
                }));
                const rows: string[][] = response.data.data ?? [];
                return { items: rows, nextCheckpoint: new Date().toISOString() };
            },
            process: async (items: any[], _ctx: ProcessContext, log: ReturnType<typeof createLog>) => {
                if (items.length === 0) return 0;
                const rows: string[][] = items;
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
                    if (existing.has(externalIds[i])) continue;
                    const url = extractUrl(urlHtml);
                    const source = extractSource(urlHtml);
                    const title = titre || 'Titre inconnu';
                    const slug = `nl-${externalIds[i]}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.substring(0, 490);
                    toInsert.push({ row: rows[i], externalId: externalIds[i], title, url, source, slug });
                }
                if (toInsert.length === 0) return 0;

                const mediaValues = toInsert.map(item => ({
                    type: 'book' as const, title: item.title, slug: item.slug, externalId: item.externalId,
                    author: item.row[1] || 'Unknown',
                    year: item.row[2] ? parseInt(item.row[2].split('-')[0]) : undefined,
                    metadataSource: 'noslivres', metadataFreshAt: new Date(),
                }));

                const inserted: any[] = await db.insert(medias).values(mediaValues).onConflictDoNothing()
                    .returning({ id: medias.id, externalId: medias.externalId, title: medias.title, slug: medias.slug });

                const extToId = new Map(inserted.map(m => [m.externalId, m.id]));
                const lienValues: any[] = [];
                for (const item of toInsert) {
                    if (!item.url) continue;
                    const mediaId = extToId.get(item.externalId);
                    if (!mediaId) continue;
                    lienValues.push({ mediaId, sourceSite: (item.source || 'noslivres').toLowerCase(), url: item.url, quality: 'original', language: 'FR' });
                }
                if (lienValues.length > 0) {
                    await db.insert(liens).values(lienValues).onConflictDoNothing();
                }

                const brainItems = inserted.map(m => ({ id: m.id, type: 'book' as const, title: m.title, slug: m.slug }));
                await notifyBrainBatch(brainItems, ctx.internalApiUrl || '', ctx.internalApiKey || '');

                await fetchOpenLibraryCoversFor(inserted, toInsert, db, log);

                for (const m of inserted) log.success(`[NL] ${m.externalId}`);
                return inserted.length;
            },
        },
        discovery: {
            maxPages: 1000,
            advanceBy: limit,
            fetchPage: async (offset: number, fetchLimit: number): Promise<FetchResult> => {
                const response = await withRetry(() => axios.get(API, {
                    params: { draw: 1, start: offset, length: fetchLimit },
                    headers: { 'X-Requested-With': 'XMLHttpRequest' },
                    timeout: 15000
                }));
                const rows: string[][] = response.data.data ?? [];
                const total = response.data.recordsTotal ?? 0;
                return { items: rows, total, hasMore: rows.length === fetchLimit };
            },
            getTotal: (result: FetchResult) => result.total || 0,
            process: async (items: any[], _ctx: ProcessContext, log: ReturnType<typeof createLog>) => {
                const rows: string[][] = items;
                if (rows.length === 0) return 0;

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
                    if (existing.has(externalIds[i])) continue;
                    const url = extractUrl(urlHtml);
                    const source = extractSource(urlHtml);
                    const title = titre || 'Titre inconnu';
                    const slug = `nl-${externalIds[i]}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.substring(0, 490);
                    toInsert.push({ row: rows[i], externalId: externalIds[i], title, url, source, slug });
                }
                if (toInsert.length === 0) {
                    log.skip('NosLivres: all existing');
                    return 0;
                }

                const mediaValues = toInsert.map(item => ({
                    type: 'book' as const, title: item.title, slug: item.slug, externalId: item.externalId,
                    author: item.row[1] || 'Unknown',
                    year: item.row[2] ? parseInt(item.row[2].split('-')[0]) : undefined,
                    metadataSource: 'noslivres', metadataFreshAt: new Date(),
                }));

                const inserted: any[] = await db.insert(medias).values(mediaValues).onConflictDoNothing()
                    .returning({ id: medias.id, externalId: medias.externalId, title: medias.title, slug: medias.slug });

                const extToId = new Map(inserted.map(m => [m.externalId, m.id]));
                const lienValues: any[] = [];
                for (const item of toInsert) {
                    if (!item.url) continue;
                    const mediaId = extToId.get(item.externalId);
                    if (!mediaId) continue;
                    lienValues.push({ mediaId, sourceSite: (item.source || 'noslivres').toLowerCase(), url: item.url, quality: 'original', language: 'FR' });
                }
                if (lienValues.length > 0) {
                    await db.insert(liens).values(lienValues).onConflictDoNothing();
                }

                const brainItems = inserted.map(m => ({ id: m.id, type: 'book' as const, title: m.title, slug: m.slug }));
                await notifyBrainBatch(brainItems, ctx.internalApiUrl || '', ctx.internalApiKey || '');

                await fetchOpenLibraryCoversFor(inserted, toInsert, db, log);

                for (const m of inserted) log.success(`[NL] ${m.externalId}`);
                return inserted.length;
            },
        },
    };

    return runScanner(config, ctx, limit);
}
