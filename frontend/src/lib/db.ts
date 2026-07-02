import type { Media } from '../types';

export interface DbMedia {
  id: string; external_id: string | null; type: string;
  title: string; original_title: string | null; slug: string;
  synopsis: string | null; year: number | null; author: string | null;
  poster_url: string | null; backdrop_url: string | null;
  rating: string | null; vote_count: number | null; status: string | null;
  tmdb_id: number | null; imdb_id: string | null;
  anilist_id: number | null; mal_id: number | null;
  kitsu_id: number | null; igdb_id: number | null;
  anidb_id: number | null; metadata_source: string | null;
  metadata_fresh_at: number | null; links_last_scraped_at: number | null;
  active_links_count: number | null;
  created_at: number | null; updated_at: number | null;
}

export function toMedia(row: DbMedia, episodes?: any[], links?: any[]): Media {
  return {
    id: row.id,
    type: row.type as Media['type'],
    title: row.title,
    slug: row.slug,
    synopsis: row.synopsis ?? undefined,
    year: row.year ?? undefined,
    posterUrl: row.poster_url ?? undefined,
    backdropUrl: row.backdrop_url ?? undefined,
    rating: row.rating ? parseFloat(row.rating) : undefined,
    voteCount: row.vote_count ?? 0,
    status: row.status ?? undefined,
    tmdbId: row.tmdb_id ?? undefined,
    imdbId: row.imdb_id ?? undefined,
    anilistId: row.anilist_id ?? undefined,
    metadataSource: row.metadata_source ?? undefined,
    activeLinksCount: row.active_links_count ?? 0,
    createdAt: row.created_at ? new Date(row.created_at * 1000).toISOString() : '',
    updatedAt: row.updated_at ? new Date(row.updated_at * 1000).toISOString() : '',
    episodes,
    links,
  };
}

export interface DbEpisode {
  id: string; media_id: string; season_number: number;
  episode_number: number; title: string | null; synopsis: string | null;
  air_date: number | null; thumbnail_url: string | null; duration: number | null;
}

export interface DbLien {
  id: string; media_id: string; episode_id: string | null;
  source_site: string; player_host: string | null; url: string;
  quality: string | null; language: string | null;
  has_subtitles: number | null; is_active: number | null;
  fail_count: number | null; last_verified: number | null;
  scraped_at: number | null; headers: string | null;
}

const MEDIA_COLS = [
  'id', 'external_id', 'type', 'title', 'original_title', 'slug',
  'synopsis', 'year', 'author', 'poster_url', 'backdrop_url',
  'rating', 'vote_count', 'status', 'tmdb_id', 'imdb_id',
  'anilist_id', 'mal_id', 'kitsu_id', 'igdb_id', 'anidb_id',
  'metadata_source', 'metadata_fresh_at', 'links_last_scraped_at',
  'active_links_count', 'created_at', 'updated_at',
].join(', ');

export async function queryGetTrending(db: any): Promise<DbMedia[]> {
  return db.query(`
    SELECT ${MEDIA_COLS} FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY type ORDER BY CAST(rating AS REAL) DESC, vote_count DESC) AS _rn FROM medias
    ) WHERE _rn <= 3
    ORDER BY CAST(rating AS REAL) DESC, vote_count DESC LIMIT 20
  `);
}

export async function queryGetByType(db: any, type: string): Promise<DbMedia[]> {
  return db.query(`
    SELECT ${MEDIA_COLS} FROM medias
    WHERE type = ?
    ORDER BY created_at DESC
  `, [type]);
}

export async function queryGetDetails(db: any, type: string, slug: string): Promise<{ media: DbMedia | null; episodes: any[]; links: any[] }> {
  const medias: DbMedia[] = await db.query(`
    SELECT ${MEDIA_COLS} FROM medias WHERE type = ? AND slug = ? LIMIT 1
  `, [type, slug]);

  if (medias.length === 0) return { media: null, episodes: [], links: [] };
  const media = medias[0];

  const hasEpisodes = type === 'serie' || type === 'anime';
  const episodes = hasEpisodes
    ? await db.query(
        `SELECT * FROM episodes WHERE media_id = ? ORDER BY season_number, episode_number`,
        [media.id]
      )
    : [];

  const links = await db.query(
    `SELECT * FROM liens WHERE media_id = ? ORDER BY source_site`,
    [media.id]
  );

  return { media, episodes, links };
}

export async function querySearch(
  db: any,
  q: string,
  type?: string,
  year?: number,
  limit: number = 20,
  offset: number = 0
): Promise<{ data: DbMedia[]; total: number }> {
  const conditions: string[] = [];
  const params: any[] = [];

  conditions.push(`(title ILIKE ? OR original_title ILIKE ?)`);
  params.push(`%${q}%`, `%${q}%`);

  if (type && type !== 'all') {
    conditions.push(`type = ?`);
    params.push(type);
  }
  if (year) {
    conditions.push(`year = ?`);
    params.push(year);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const data = await db.query(
    `SELECT ${MEDIA_COLS} FROM medias ${where} ORDER BY CAST(rating AS REAL) DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const countResult = await db.query(
    `SELECT COUNT(*) as cnt FROM medias ${where}`,
    params
  );
  const total = countResult[0]?.cnt ?? 0;

  return { data, total };
}
