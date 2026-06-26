import axios from 'axios';
import { createDbClient } from '../db/client.js';
import { medias } from '../db/neon/schema.js';
import { eq, inArray } from 'drizzle-orm';
import { batchCheckExisting } from '../utils/batch-import.js';

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
    tags: { attributes: { name: Record<string, string>; group: string } }[];
  };
  relationships: { type: string; attributes?: { fileName: string } }[];
}

async function fetchCovers(mangaIds: string[]): Promise<Map<string, string>> {
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
        if (mangaId && fn) coverMap.set(mangaId, `https://uploads.mangadex.org/covers/${mangaId}/${fn}.256.jpg`);
      }
    } catch (err) {
      console.error(`Failed to fetch cover batch: ${err instanceof Error ? err.message : err}`);
    }
  }
  return coverMap;
}

export async function importTrendingManga(databaseUrl: string, searchTerm: string = '') {
    const db = createDbClient(databaseUrl, 'neon');

    try {
        const params: any = { limit: 20, includes: ['cover_art'] };
        if (searchTerm && searchTerm !== 'trending') {
          params.title = searchTerm;
          params.order = { relevance: 'desc' };
        } else {
          params.order = { followedCount: 'desc' };
        }

        console.log(`📡 MangaDex API: ${searchTerm ? `search "${searchTerm}"` : 'trending (followedCount)'}`);
        const response = await axios.get(`${MANGADEX_API}/manga`, { params, timeout: 15000 });
        const mangaList: MdManga[] = response.data.data || [];
        console.log(`📦 ${mangaList.length} mangas trouvés`);

        const ids = mangaList.map(m => m.id);
        const covers = await fetchCovers(ids);

        const existing = await batchCheckExisting(db, medias.externalId, ids);

        const toInsert = mangaList.filter(m => !existing.has(m.id));
        if (toInsert.length === 0) {
            console.log('📄 MangaDex: tout existant déjà');
            return 0;
        }

        const mediaValues = toInsert.map(manga => {
            const attr = manga.attributes;
            const title = Object.values(attr.title || {}).find(Boolean) as string || 'Unknown';
            const slug = title.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, '').substring(0, 490);
            const desc = Object.values(attr.description || {}).find(Boolean) as string || '';
            return {
                type: 'webtoon', title, synopsis: desc,
                posterUrl: covers.get(manga.id) || undefined,
                year: attr.year || undefined, status: attr.status || undefined,
                externalId: manga.id, slug,
                metadataSource: 'mangadex', metadataFreshAt: new Date(),
            };
        });

        const inserted = await db.insert(medias).values(mediaValues).onConflictDoNothing().returning({ id: medias.id, externalId: medias.externalId });

        for (const m of inserted) {
            try {
                await axios.post(`${INTERNAL_API_URL}/ingest/media`, {
                    id: m.id, type: 'webtoon', metadata_ok: 1,
                }, {
                    headers: { 'X-Internal-API-Key': INTERNAL_API_KEY },
                    timeout: 5000,
                });
            } catch (err) {
                console.error(`Failed to sync manga ${m.id} to internal API: ${err instanceof Error ? err.message : err}`);
            }
            console.log(`✅ [MANGADEX] ${m.externalId}`);
        }

        console.log(`✅ Import MangaDex terminé : ${inserted.length} nouveaux mangas.`);
        return inserted.length;
    } catch (error: any) {
        console.error('❌ MangaDex Import Error:', error.message);
        throw error;
    }
}
