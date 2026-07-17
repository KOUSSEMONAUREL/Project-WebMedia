interface ExternalResult {
  title: string;
  type: string;
  synopsis?: string;
  year?: number;
  posterUrl?: string;
  rating?: number;
  externalId?: string;
  metadataSource?: string;
  slug?: string;
}

function extractSlug(title: string, externalId?: string): string {
  if (externalId) return externalId;
  return title.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 100);
}

const TMDB_API = 'https://api.themoviedb.org/3';

export async function searchTmdb(q: string, type: string | undefined, tmdbKey: string): Promise<ExternalResult[]> {
  if (!tmdbKey) return [];
  if (type && !['film', 'serie', 'anime', 'all'].includes(type)) return [];

  try {
    const multi = type && type !== 'all'
      ? `${TMDB_API}/search/${type === 'film' ? 'movie' : type === 'serie' ? 'tv' : 'tv'}`
      : `${TMDB_API}/search/multi`;

    const res = await fetch(`${multi}?query=${encodeURIComponent(q)}&api_key=${tmdbKey}&language=fr-FR&page=1`, {
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    const results = data.results || [];

    return results.filter((r: any) => r.media_type !== 'person').slice(0, 8).map((r: any) => {
      const mediaType = r.media_type === 'movie' ? 'film' : r.media_type === 'tv' ? 'serie' : 'serie';
      return {
        title: r.title || r.name || '',
        type: mediaType,
        synopsis: r.overview || '',
        year: (r.release_date || r.first_air_date || '').slice(0, 4) || undefined,
        posterUrl: r.poster_path ? `https://image.tmdb.org/t/p/w342${r.poster_path}` : undefined,
        rating: r.vote_average || undefined,
        externalId: String(r.id),
        metadataSource: 'tmdb',
        slug: extractSlug(r.title || r.name || '', String(r.id)),
      };
    });
  } catch {
    return [];
  }
}

const ANILIST_API = 'https://graphql.anilist.co';

export async function searchAnilist(q: string, type?: string): Promise<ExternalResult[]> {
  if (type && !['anime', 'all'].includes(type)) return [];

  const query = `
    query ($q: String) {
      Page (perPage: 8) {
        media (search: $q, type: ANIME) {
          id
          title { romaji english native }
          description
          startDate { year }
          coverImage { large }
          averageScore
          format
        }
      }
    }`;

  try {
    const res = await fetch(ANILIST_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query, variables: { q } }),
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    const media = data?.data?.Page?.media || [];
    return media.map((m: any) => ({
      title: m.title?.romaji || m.title?.english || '',
      type: 'anime',
      synopsis: (m.description || '').replace(/<[^>]*>/g, '').slice(0, 500),
      year: m.startDate?.year || undefined,
      posterUrl: m.coverImage?.large || undefined,
      rating: m.averageScore ? m.averageScore / 10 : undefined,
      externalId: String(m.id),
      metadataSource: 'anilist',
      slug: extractSlug(m.title?.romaji || m.title?.english || '', String(m.id)),
    }));
  } catch {
    return [];
  }
}

const GOOGLE_BOOKS_API = 'https://www.googleapis.com/books/v1/volumes';

export async function searchGoogleBooks(q: string, apiKey: string): Promise<ExternalResult[]> {
  if (!apiKey) return [];

  try {
    const res = await fetch(`${GOOGLE_BOOKS_API}?q=${encodeURIComponent(q)}&key=${apiKey}&langRestrict=fr&maxResults=8`, {
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    const items = data.items || [];
    return items.map((item: any) => {
      const info = item.volumeInfo || {};
      return {
        title: info.title || '',
        type: 'book',
        synopsis: info.description || '',
        year: info.publishedDate ? parseInt(info.publishedDate) || undefined : undefined,
        posterUrl: info.imageLinks?.thumbnail || undefined,
        rating: info.averageRating || undefined,
        externalId: `googlebooks-${item.id}`,
        metadataSource: 'googlebooks',
        slug: extractSlug(info.title || '', item.id),
      };
    });
  } catch {
    return [];
  }
}

const MANGADEX_API = 'https://api.mangadex.org';

export async function searchMangaDex(q: string): Promise<ExternalResult[]> {

  try {
    const res = await fetch(`${MANGADEX_API}/manga?title=${encodeURIComponent(q)}&limit=8&includes[]=cover_art`, {
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    const results = data.data || [];
    return results.map((m: any) => {
      const attrs = m.attributes || {};
      const title = attrs.title?.en || Object.values(attrs.title || {})[0] || '';
      const coverRel = (m.relationships || []).find((r: any) => r.type === 'cover_art');
      const coverFile = coverRel?.attributes?.fileName;
      return {
        title: String(title),
        type: 'webtoon',
        synopsis: (attrs.description?.en || '').slice(0, 500),
        year: attrs.year || undefined,
        posterUrl: coverFile ? `https://uploads.mangadex.org/covers/${m.id}/${coverFile}.256.jpg` : undefined,
        rating: attrs.rating?.average || undefined,
        externalId: m.id,
        metadataSource: 'mangadex',
        slug: extractSlug(String(title), m.id),
      };
    });
  } catch {
    return [];
  }
}

async function getTwitchToken(clientId: string, clientSecret: string): Promise<string | null> {
  try {
    const res = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`, {
      method: 'POST',
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    return data.access_token || null;
  } catch {
    return null;
  }
}

const IGDB_API = 'https://api.igdb.com/v4/games';

export async function searchIgdb(q: string, twitchId: string, twitchSecret: string): Promise<ExternalResult[]> {
  if (!twitchId || !twitchSecret) return [];

  try {
    const token = await getTwitchToken(twitchId, twitchSecret);
    if (!token) return [];

    const res = await fetch(IGDB_API, {
      method: 'POST',
      headers: {
        'Client-ID': twitchId,
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
      body: `search "${q.replace(/"/g, '')}"; fields name,summary,cover.url,first_release_date,total_rating; limit 8;`,
    });
    if (!res.ok) return [];
    const results: any = await res.json();
    return (results || []).map((r: any) => ({
      title: r.name || '',
      type: 'jeu',
      synopsis: r.summary || '',
      year: r.first_release_date ? new Date(r.first_release_date * 1000).getFullYear() : undefined,
      posterUrl: r.cover?.url ? r.cover.url.replace('t_thumb', 't_cover_big') : undefined,
      rating: r.total_rating ? r.total_rating / 100 : undefined,
      externalId: String(r.id),
      metadataSource: 'igdb',
      slug: extractSlug(r.name || '', String(r.id)),
    }));
  } catch {
    return [];
  }
}

const ROYAL_ROAD_API = 'https://www.royalroad.com';

export async function searchRoyalRoad(q: string): Promise<ExternalResult[]> {

  try {
    const res = await fetch(`${ROYAL_ROAD_API}/api/fictions/search?term=${encodeURIComponent(q)}&page=1&perPage=8`, {
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    const results = data.data || data.results || [];
    return (results || []).map((r: any) => ({
      title: r.title || r.name || '',
      type: 'novel',
      synopsis: r.description || '',
      year: undefined,
      posterUrl: r.cover || r.coverUrl || undefined,
      rating: r.rating || r.stats?.rating?.average || undefined,
      externalId: String(r.id || r._id),
      metadataSource: 'royalroad',
      slug: extractSlug(r.title || r.name || '', String(r.id || r._id)),
    }));
  } catch {
    return [];
  }
}

export async function searchExternalSources(
  q: string,
  type: string | undefined,
  env: { TMDB_API_KEY?: string; GOOGLE_BOOKS_API_KEY?: string; TWITCH_CLIENT_ID?: string; TWITCH_CLIENT_SECRET?: string }
): Promise<ExternalResult[]> {
  const promises: Promise<ExternalResult[]>[] = [];

  if (!type || type === 'all' || type === 'film' || type === 'serie' || type === 'anime') {
    promises.push(searchTmdb(q, type, env.TMDB_API_KEY || ''));
    if (!type || type === 'all' || type === 'anime') {
      promises.push(searchAnilist(q, type));
    }
  }
  if (!type || type === 'all' || type === 'book') {
    promises.push(searchGoogleBooks(q, env.GOOGLE_BOOKS_API_KEY || ''));
  }
  if (!type || type === 'all' || type === 'webtoon') {
    promises.push(searchMangaDex(q));
  }
  if (!type || type === 'all' || type === 'jeu') {
    promises.push(searchIgdb(q, env.TWITCH_CLIENT_ID || '', env.TWITCH_CLIENT_SECRET || ''));
  }
  if (!type || type === 'all' || type === 'novel') {
    promises.push(searchRoyalRoad(q));
  }

  const results = await Promise.all(promises);
  return results.flat();
}
