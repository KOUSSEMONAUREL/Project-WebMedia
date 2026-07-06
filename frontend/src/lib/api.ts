import type { Media, MediaType } from './types';
import { mockTrending, mockFilms, mockSeries, mockAnimes, mockGames, mockWebtoons, allMockData, getMockByType } from './mockData';
export { allMockData, getMockByType };

const API_BASE_URL = import.meta.env.PUBLIC_API_URL || 'http://localhost:8787/api';

async function apiClient<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!response.ok) throw new Error(`API Error: ${response.status} ${response.statusText}`);
  return await response.json();
}

let localDb: any = null;
let dbInitError: Error | null = null;

async function initLocalDb(): Promise<any> {
  if (localDb) return localDb;
  if (dbInitError) return null;

  try {
    if (typeof window !== 'undefined') {
      const { default: initSqlJs } = await import('sql.js');
      const SQL = await initSqlJs({ locateFile: () => '/data/sql-wasm.wasm' });
      const resp = await fetch('/data/catalogue.sqlite');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = await resp.arrayBuffer();
      localDb = new SQL.Database(new Uint8Array(buf));
    } else if (typeof process !== 'undefined' && process.versions?.node) {
      const { resolve } = await import('path');
      const { existsSync } = await import('fs');
      const Database = (await import('better-sqlite3')).default;
      const dbPath = resolve(process.cwd(), 'public/data/catalogue.sqlite');
      if (!existsSync(dbPath)) throw new Error('catalogue.sqlite not found');
      const db = new Database(dbPath, { readonly: true });
      db.pragma('cache_size = -8000');
      localDb = {
        query: (sql: string, params?: any[]) => {
          const stmt = db.prepare(sql);
          return params ? stmt.all(...params) : stmt.all();
        },
      };
    }
    return localDb;
  } catch (err: any) {
    dbInitError = err;
    console.warn('[db] local init failed:', err.message);
    return null;
  }
}

async function queryMedias(sql: string, params?: any[]) {
  const db = await initLocalDb();
  if (!db) return null;
  try {
    if (typeof window !== 'undefined') {
      const stmt = db.prepare(sql);
      if (params) stmt.bind(params);
      const rows: any[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    }
    return db.query(sql, params);
  } catch {
    return null;
  }
}

function formatMedia(row: any): Media {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    slug: row.slug,
    synopsis: row.synopsis || undefined,
    year: row.year || undefined,
    posterUrl: row.poster_url || undefined,
    backdropUrl: row.backdrop_url || undefined,
    rating: row.rating ? parseFloat(row.rating) : undefined,
    voteCount: row.vote_count ?? 0,
    status: row.status || undefined,
    tmdbId: row.tmdb_id || undefined,
    imdbId: row.imdb_id || undefined,
    anilistId: row.anilist_id || undefined,
    metadataSource: row.metadata_source || undefined,
    activeLinksCount: row.active_links_count ?? 0,
    genres: row.genres ? JSON.parse(row.genres) : undefined,
    trailerUrl: row.trailer_url || undefined,
    duration: row.duration || undefined,
    tagline: row.tagline || undefined,
    studios: row.studios ? JSON.parse(row.studios) : undefined,
    episodeCount: row.episode_count || undefined,
    author: row.author || undefined,
    originalTitle: row.original_title || undefined,
    externalId: row.external_id || undefined,
    malId: row.mal_id || undefined,
    kitsuId: row.kitsu_id || undefined,
    igdbId: row.igdb_id || undefined,
    anidbId: row.anidb_id || undefined,
    createdAt: row.created_at ? new Date(row.created_at * 1000).toISOString() : '',
    updatedAt: row.updated_at ? new Date(row.updated_at * 1000).toISOString() : '',
  };
}

const MEDIA_COLS = [
  'id', 'external_id', 'type', 'title', 'original_title', 'slug',
  'synopsis', 'year', 'author', 'poster_url', 'backdrop_url',
  'rating', 'vote_count', 'status', 'tmdb_id', 'imdb_id',
  'anilist_id', 'mal_id', 'kitsu_id', 'igdb_id', 'anidb_id',
  'metadata_source', 'active_links_count', 'created_at', 'updated_at',
  'genres', 'trailer_url', 'duration', 'tagline', 'studios', 'episode_count',
].join(', ');

export async function getTrending(): Promise<ApiResponse<Media[]>> {
  const rows = await queryMedias(
    `SELECT ${MEDIA_COLS} FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY type ORDER BY CAST(rating AS REAL) DESC, vote_count DESC) AS _rn FROM medias) WHERE _rn <= 3 ORDER BY CAST(rating AS REAL) DESC, vote_count DESC LIMIT 20`
  );
  if (rows) return { success: true, data: rows.map(formatMedia) };
  try { return await apiClient('/media/trending'); }
  catch { return { success: true, data: mockTrending }; }
}

export async function getMediaByType(type: MediaType): Promise<ApiResponse<Media[]>> {
  const rows = await queryMedias(
    `SELECT ${MEDIA_COLS} FROM medias WHERE type = ? ORDER BY created_at DESC`, [type]
  );
  if (rows) return { success: true, data: rows.map(formatMedia) };
  try { return await apiClient(`/media?type=${type}`); }
  catch { return { success: true, data: getMockByType(type) }; }
}

export async function getAllMedia(): Promise<Media[]> {
  const rows = await queryMedias(`SELECT ${MEDIA_COLS} FROM medias ORDER BY created_at`);
  if (rows) return rows.map(formatMedia);
  try {
    const res = await apiClient<ApiResponse<Media[]>>('/media');
    return res.data;
  } catch {
    return allMockData;
  }
}

export async function searchMedia(query: string, filters?: {
  type?: MediaType | 'all'; year?: number; genre?: string;
}): Promise<ApiResponse<Media[]>> {
  const db = await initLocalDb();
  if (db) {
    const conditions = [`(title ILIKE ? OR original_title ILIKE ?)`];
    const params: any[] = [`%${query}%`, `%${query}%`];
    if (filters?.type && filters.type !== 'all') { conditions.push('type = ?'); params.push(filters.type); }
    if (filters?.year) { conditions.push('year = ?'); params.push(filters.year); }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const rows = await queryMedias(
      `SELECT ${MEDIA_COLS} FROM medias ${where} ORDER BY CAST(rating AS REAL) DESC LIMIT 50`,
      params
    );
    if (rows) return { success: true, data: rows.map(formatMedia), count: rows.length };
  }
  try {
    const apiParams = new URLSearchParams({ q: query });
    if (filters?.type) apiParams.set('type', filters.type);
    if (filters?.year) apiParams.set('year', filters.year.toString());
    return await apiClient(`/search?${apiParams.toString()}`);
  } catch {
    const lowerQuery = query.toLowerCase();
    let results = allMockData.filter(m => m.title.toLowerCase().includes(lowerQuery));
    if (filters?.type && filters.type !== 'all') results = results.filter(m => m.type === filters.type);
    return { success: true, data: results };
  }
}

export async function getMediaDetails(type: string, slug: string): Promise<ApiResponse<Media>> {
  const db = await initLocalDb();
  if (db) {
    const rows = await queryMedias(
      `SELECT ${MEDIA_COLS} FROM medias WHERE type = ? AND slug = ? LIMIT 1`, [type, slug]
    );
    if (rows && rows.length > 0) {
      const media = formatMedia(rows[0]);
      const episodes = ['serie', 'anime'].includes(type)
        ? (await queryMedias(
            `SELECT * FROM episodes WHERE media_id = ? ORDER BY season_number, episode_number`,
            [rows[0].id]
          )) || []
        : [];
      const links = (await queryMedias(
        `SELECT * FROM liens WHERE media_id = ? ORDER BY source_site`, [rows[0].id]
      )) || [];
      return { success: true, data: { ...media, episodes, links } };
    }
  }
  try { return await apiClient(`/media/${type}/${slug}`); }
  catch {
    const media = allMockData.find(m => m.type === type && m.slug === slug);
    if (media) return { success: true, data: media };
    throw new Error('Média non trouvé');
  }
}

export async function queryLocalDb(sql: string, params?: any[]) {
  return queryMedias(sql, params);
}

export type { Media, MediaType, LegalLink, ApiResponse } from './types';
