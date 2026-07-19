import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias } from '../db/neon/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { batchCheckExisting } from '../utils/batch-import.js';
import { getOffset, setOffset } from '../utils/offset-tracker.js';
import { createLog } from '../utils/log.js';

const MANGADEX_API = 'https://api.mangadex.org';
const INTERNAL_API_URL = process.env.INTERNAL_API_URL || (process.env.ENVIRONMENT === 'development' ? 'http://localhost:8787/api/internal' : 'https://api.webmedia.com/api/internal');
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

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

async function processMangaDexOffset(offset: number, limit: number, searchTerm: string, db: any, log: ReturnType<typeof createLog>): Promise<number> {
    const params: any = { limit, offset, includes: ['cover_art', 'author', 'artist'] };
    if (searchTerm && searchTerm !== 'trending') {
      params.title = searchTerm;
      params.order = { relevance: 'desc' };
    } else {
      params.order = { followedCount: 'desc' };
    }

    log.info(`API (offset=${offset}): ${searchTerm ? `search "${searchTerm}"` : 'trending (followedCount)'}`);
    const response = await axios.get(`${MANGADEX_API}/manga`, { params, timeout: 15000 });
    const mangaList: MdManga[] = response.data.data || [];
    log.info(`${mangaList.length} mangas found`);

    if (mangaList.length === 0) return 0;

    const ids = mangaList.map(m => m.id);
    const covers = await fetchCovers(ids, log);

    const prefixedIds = ids.map(id => `mangadex-${id}`);
    const existing = await batchCheckExisting(db, medias.externalId, prefixedIds);

    const toInsert = mangaList.filter(m => !existing.has(`mangadex-${m.id}`));
    if (toInsert.length === 0) {
        log.skip('MangaDex: all existing');
        return 0;
    }

    const mediaValues = toInsert.map(manga => {
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
            .filter(t => t.attributes?.group === 'genre')
            .map(t => {
                const name = t.attributes?.name;
                return Object.values(name || {}).find(Boolean) as string;
            })
            .filter(Boolean);
        const formatTags = (attr.tags || [])
            .filter(t => t.attributes?.group === 'format')
            .map(t => {
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
            type: 'webtoon', title, synopsis: desc,
            posterUrl: posterUrl || undefined,
            year: attr.year || undefined,
            status: attr.status || undefined,
            genres: allGenres.length ? JSON.stringify(allGenres) : undefined,
            author: authorName || undefined,
            externalId: `mangadex-${manga.id}`, slug,
            metadataSource: 'mangadex', metadataFreshAt: new Date(),
        };
    });

    const inserted: any[] = await db.insert(medias).values(mediaValues).onConflictDoNothing().returning({ id: medias.id, externalId: medias.externalId });

    for (const m of inserted) {
        try {
            await axios.post(`${INTERNAL_API_URL}/ingest/media`, {
                id: m.id, type: 'webtoon', metadata_ok: 1,
            }, {
                headers: { 'X-Internal-API-Key': INTERNAL_API_KEY },
                timeout: 5000,
            });
        } catch (err) {
            log.error(`Failed to sync manga ${m.id}: ${err instanceof Error ? err.message : err}`);
        }
        log.success(`[MANGADEX] ${m.externalId}`);
    }

    log.success(`Import finished: ${inserted.length} new mangas (offset=${offset})`);
    return inserted.length;
}

export async function importTrendingManga(databaseUrl: string, searchTerm: string = '', limit = 20) {
    const db = createDbClient(databaseUrl, 'neon');
    const log = createLog('MangaDex', 'one-shot');
    log.start(`Import (limit=${limit})`);

    try {
        const offset = await getOffset('mangadex-offset', databaseUrl, 0, db);

        // Freshness pass: always check offset 0 for newly popular manga
        let freshCount = 0;
        if (offset > 0) {
            try {
                freshCount = await processMangaDexOffset(0, limit, searchTerm, db, log);
                if (freshCount > 0) log.info(`Freshness: ${freshCount} new mangas`);
            } catch (err: any) {
                log.warn(`Freshness pass failed: ${err.message}`);
            }
        }

        // Deep pass: continue from stored offset
        const deepCount = await processMangaDexOffset(offset, limit, searchTerm, db, log);
        await setOffset('mangadex-offset', offset + limit, databaseUrl, db);

        log.success(`MangaDex: ${deepCount + freshCount} total`);
        return deepCount + freshCount;
    } catch (error: any) {
        log.error(`MangaDex Import Error: ${error.message}`);
        throw error;
    }
}
