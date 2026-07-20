import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias } from '../db/neon/schema.js';
import { eq } from 'drizzle-orm';
import { batchCheckExisting } from '../utils/batch-import.js';
import { runScanner } from '../utils/api-scanner.js';
import type { ScannerConfig, ProcessContext, FetchResult } from '../utils/api-scanner.js';
import type { createLog } from '../utils/log.js';

const MANGADEX_API = 'https://api.mangadex.org';
const KEY = 'mangadex';

interface MdManga {
  id: string;
  attributes: {
    title: Record<string, string>;
    description: Record<string, string>;
    year: number;
    status: string;
    contentRating: string;
    originalLanguage: string;
    publicationDemographic: string;
    tags: { attributes: { name: Record<string, string>; group: string } }[];
  };
  relationships: { type: string; attributes?: { fileName: string } }[];
}

async function fetchCovers(mangaIds: string[], log: ReturnType<typeof createLog>): Promise<Map<string, string>> {
  const coverMap = new Map<string, string>();
  const batches: string[][] = [];
  for (let i = 0; i < mangaIds.length; i += 100) batches.push(mangaIds.slice(i, i + 100));
  for (const batch of batches) {
    try {
      const res = await axios.get(`${MANGADEX_API}/cover`, {
        params: { limit: 100, 'manga[]': batch, order: { volume: 'desc' } },
        timeout: 10000,
      });
      for (const rel of res.data.data || []) {
        const mangaId = rel.relationships?.find((r: any) => r.type === 'manga')?.id;
        const fn = rel.attributes?.fileName;
        if (mangaId && fn) coverMap.set(mangaId, `https://uploads.mangadex.org/covers/${mangaId}/${fn}`);
      }
    } catch (err) {
      log.error(`Failed to fetch cover batch: ${err instanceof Error ? err.message : err}`);
    }
  }
  return coverMap;
}

function buildMediaRow(manga: MdManga, covers: Map<string, string>) {
    const attr = manga.attributes;
    const title = Object.values(attr.title || {}).find(Boolean) as string || 'Unknown';
    const slug = title.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, '').substring(0, 490);
    const desc = Object.values(attr.description || {}).find(Boolean) as string || '';
    let posterUrl = covers.get(manga.id);
    if (!posterUrl) {
      const coverArt = manga.relationships?.find(r => r.type === 'cover_art');
      const fn = coverArt?.attributes?.fileName;
      if (fn) posterUrl = `https://uploads.mangadex.org/covers/${manga.id}/${fn}`;
    }
    const genreTags = (attr.tags || [])
        .filter((t: any) => t.attributes?.group === 'genre')
        .map((t: any) => {
            const name = t.attributes?.name;
            return Object.values(name || {}).find(Boolean) as string;
        })
        .filter(Boolean);
    const formatTags = (attr.tags || [])
        .filter((t: any) => t.attributes?.group === 'format')
        .map((t: any) => {
            const name = t.attributes?.name;
            return Object.values(name || {}).find(Boolean) as string;
        })
        .filter(Boolean);
    const allGenres = [...new Set([...genreTags, ...formatTags])];
    const authorName = (manga.relationships || [])
        .filter(r => r.type === 'author' || r.type === 'artist')
        .map(r => r.attributes as any)
        .filter(Boolean)
        .map(a => Object.values(a.name || {}).find(Boolean) as string)
        .filter(Boolean)
        .join(', ');
    return {
        type: 'webtoon' as const, title, synopsis: desc,
        posterUrl: posterUrl || undefined,
        year: attr.year || undefined,
        status: attr.status || undefined,
        genres: allGenres.length ? JSON.stringify(allGenres) : undefined,
        author: authorName || undefined,
        externalId: `mangadex-${manga.id}`, slug,
        metadataSource: 'mangadex', metadataFreshAt: new Date(),
    };
}

export async function importTrendingManga(databaseUrl: string, searchTerm: string = '', limit = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    const ctx: ProcessContext = { db, databaseUrl };

    const config: ScannerConfig = {
        key: KEY,
        name: 'MangaDex',
        rateLimit: { requestsPerSecond: 4, maxConcurrent: 1 },
        freshness: {
            maxHistoryDays: 3,
            defaultCheckpointAgeMs: 3600 * 1000,
            fetch: async (fetchLimit: number, checkpoint: string) => {
                const params: any = {
                    limit: fetchLimit, offset: 0,
                    includes: ['cover_art', 'author', 'artist'],
                    'order[updatedAt]': 'desc',
                };
                const response = await axios.get(`${MANGADEX_API}/manga`, { params, timeout: 15000 });
                const mangaList: MdManga[] = response.data.data || [];
                return { items: mangaList, nextCheckpoint: new Date().toISOString() };
            },
            process: async (items: any[], _ctx: ProcessContext, log: ReturnType<typeof createLog>) => {
                if (items.length === 0) return 0;
                const ids = items.map((m: MdManga) => m.id);
                const existing = await batchCheckExisting(db, medias.externalId, ids.map(id => `mangadex-${id}`));
                const toUpdate = items.filter((m: MdManga) => existing.has(`mangadex-${m.id}`));
                if (toUpdate.length === 0) return 0;

                const covers = await fetchCovers(toUpdate.map(m => m.id), log);
                for (const manga of toUpdate) {
                    const row = buildMediaRow(manga, covers);
                    await db.update(medias).set({
                        ...row, externalId: undefined, slug: undefined, type: undefined, metadataFreshAt: new Date(),
                    }).where(eq(medias.externalId, `mangadex-${manga.id}`));
                }

                const toInsert = items.filter((m: MdManga) => !existing.has(`mangadex-${m.id}`));
                if (toInsert.length > 0) {
                    const insertCovers = await fetchCovers(toInsert.map(m => m.id), log);
                    const mediaValues = toInsert.map(manga => buildMediaRow(manga, insertCovers));
                    const inserted: any[] = await db.insert(medias).values(mediaValues).onConflictDoNothing()
                        .returning({ id: medias.id, externalId: medias.externalId });

                    for (const m of inserted) {
                        try {
                            await axios.post(`${ctx.internalApiUrl || ''}/ingest/media`, {
                                id: m.id, type: 'webtoon', metadata_ok: 1,
                            }, {
                                headers: { 'X-Internal-API-Key': ctx.internalApiKey || '' },
                                timeout: 5000,
                            });
                        } catch { /* ignore */ }
                        log.success(`[MANGADEX] ${m.externalId}`);
                    }
                }

                log.info(`Freshness: ${toUpdate.length + toInsert.length} affected`);
                return toUpdate.length + toInsert.length;
            },
        },
        discovery: {
            maxPages: 500,
            advanceBy: limit,
            fetchPage: async (offset: number, fetchLimit: number): Promise<FetchResult> => {
                const params: any = { limit: fetchLimit, offset, includes: ['cover_art', 'author', 'artist'] };
                if (searchTerm && searchTerm !== 'trending') {
                    params.title = searchTerm;
                    params.order = { relevance: 'desc' };
                } else {
                    params.order = { followedCount: 'desc' };
                }
                const response = await axios.get(`${MANGADEX_API}/manga`, { params, timeout: 15000 });
                const mangaList: MdManga[] = response.data.data || [];
                return { items: mangaList, hasMore: mangaList.length === fetchLimit };
            },
            getTotal: () => 0,
            process: async (items: any[], _ctx: ProcessContext, log: ReturnType<typeof createLog>) => {
                if (items.length === 0) return 0;
                const ids = items.map((m: MdManga) => m.id);
                const existing = await batchCheckExisting(db, medias.externalId, ids.map(id => `mangadex-${id}`));
                const toInsert = items.filter((m: MdManga) => !existing.has(`mangadex-${m.id}`));
                if (toInsert.length === 0) {
                    log.skip('MangaDex: all existing');
                    return 0;
                }

                const covers = await fetchCovers(toInsert.map(m => m.id), log);
                const mediaValues = toInsert.map(manga => buildMediaRow(manga, covers));
                const inserted: any[] = await db.insert(medias).values(mediaValues).onConflictDoNothing()
                    .returning({ id: medias.id, externalId: medias.externalId });

                for (const m of inserted) {
                    try {
                        await axios.post(`${ctx.internalApiUrl || ''}/ingest/media`, {
                            id: m.id, type: 'webtoon', metadata_ok: 1,
                        }, {
                            headers: { 'X-Internal-API-Key': ctx.internalApiKey || '' },
                            timeout: 5000,
                        });
                    } catch { /* ignore */ }
                    log.success(`[MANGADEX] ${m.externalId}`);
                }
                return inserted.length;
            },
        },
    };

    return runScanner(config, ctx, limit);
}
