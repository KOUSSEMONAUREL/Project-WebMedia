import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const API_URL = 'https://xqjjktixlttbqbsdpaxe.supabase.co/rest/v1';
const API_KEY = 'sb_publishable__ow-g4H00jio3RK5qQaJuA_87iakWRc';

interface SeriesListDto {
  id: string;
  title: string;
  slug: string;
  cover_url: string;
  is_r18: boolean;
  created_at: string;
  chapters: { published_at: string; created_at: string }[];
}

interface AuthorDto {
  name: string;
  role: string;
}

interface SeriesDetailsDto {
  id: string;
  title: string;
  slug: string;
  cover_url: string;
  description: string | null;
  status: string | null;
  is_r18: boolean;
  alt_titles: string[] | null;
  authors: AuthorDto[] | null;
  mangadex_id: string | null;
  anilist_id: number | null;
  mal_id: number | null;
  series_genres: { genres: { name: string } | null }[];
  chapters: {
    id: string;
    chapter_number: number;
    volume_number: number | null;
    title: string | null;
    published_at: string | null;
    created_at: string;
  }[];
}

interface ChapterPagesDto {
  series: { is_r18: boolean };
  chapter_pages: { object_key: string }[];
}

export class SchalescansScraper extends BaseScraper {
  readonly name = 'SchaleScans';
  readonly baseUrl = 'https://www.schalescans.com';

  private siteBase(isR18: boolean): string {
    return isR18 ? 'https://r18.schalescans.com' : this.baseUrl;
  }

  private seriesFilter(mangaUrl: string): { key: string; value: string } {
    const value = mangaUrl.trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      return { key: 'id', value };
    }
    try {
      const segments = new URL(value).pathname.split('/').filter(Boolean);
      const index = segments.indexOf('manga');
      const slug = index >= 0 ? segments[index + 1] : segments.pop();
      if (slug) return { key: 'slug', value: slug };
    } catch {
      const slug = value.split('/').filter(Boolean).pop();
      if (slug) return { key: 'slug', value: slug };
    }
    return { key: 'slug', value };
  }
  readonly lang = 'en';

  private async apiSeries(params: Record<string, string>): Promise<unknown> {
    const url = new URL(`${API_URL}/series`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const res = await this.get(url.toString(), {
      headers: { Accept: 'application/json', apikey: API_KEY },
    });
    return res.data;
  }

  async getPopular(page = 1): Promise<SearchResult> {
    if (page > 1) return { mangas: [], hasNextPage: false };
    const rows = (await this.apiSeries({
      select: 'id,title,slug,cover_url,is_r18,created_at,chapters(published_at,created_at)',
      'chapters.pages_ready': 'eq.true',
      'chapters.order': 'published_at.desc.nullslast',
      'chapters.limit': '1',
    })) as SeriesListDto[];
    return {
      mangas: rows.filter(r => r.chapters.length > 0).map(r => this.toListManga(r)),
      hasNextPage: false,
    };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getPopular(page);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (page > 1) return { mangas: [], hasNextPage: false };
    const params: Record<string, string> = {
      select: 'id,title,slug,cover_url,is_r18,created_at,chapters(published_at,created_at)',
      'chapters.pages_ready': 'eq.true',
      'chapters.order': 'published_at.desc.nullslast',
      'chapters.limit': '1',
    };
    const q = query.trim();
    if (q) params.title = `ilike.*${q}*`;
    const rows = (await this.apiSeries(params)) as SeriesListDto[];
    return {
      mangas: rows.filter(r => r.chapters.length > 0).map(r => this.toListManga(r)),
      hasNextPage: false,
    };
  }

  private toListManga(row: SeriesListDto): Manga {
    return {
      title: row.title,
      url: `${this.siteBase(row.is_r18)}/manga/${row.slug}`,
      thumbnailUrl: row.cover_url,
      lang: this.lang,
    };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const filter = this.seriesFilter(mangaUrl);
    const rows = (await this.apiSeries({
      select:
        'id,title,slug,cover_url,description,status,is_r18,alt_titles,authors,mangadex_id,anilist_id,mal_id,series_genres(genres(name)),chapters(id,chapter_number,volume_number,title,published_at,created_at)',
      [filter.key]: `eq.${filter.value}`,
      'chapters.pages_ready': 'eq.true',
      'chapters.order': 'chapter_number.desc',
    })) as SeriesDetailsDto[];
    const series = rows[0];
    if (!series) throw new Error(`Series not found: ${mangaUrl}`);

    const status = (series.status || '').toLowerCase();
    const parts: string[] = [];
    if (series.description?.trim()) parts.push(series.description.trim());
    if (series.alt_titles?.length) {
      parts.push('Alternative titles:\n' + series.alt_titles.map(t => `- ${t}`).join('\n'));
    }
    const links: string[] = [];
    if (series.mangadex_id) links.push(`[MangaDex](https://mangadex.org/title/${series.mangadex_id})`);
    if (series.anilist_id) links.push(`[AniList](https://anilist.co/manga/${series.anilist_id})`);
    if (series.mal_id) links.push(`[MyAnimeList](https://myanimelist.net/manga/${series.mal_id})`);
    if (links.length) parts.push('Links:\n' + links.join('\n'));

    const genres = series.series_genres
      .map(g => g.genres?.name)
      .filter((name): name is string => !!name);

    return {
      title: series.title,
      url: mangaUrl,
      thumbnailUrl: series.cover_url,
      description: parts.join('\n\n') || undefined,
      author:
        series.authors?.filter(a => a.role === 'author').map(a => a.name).join(', ') || undefined,
      artist:
        series.authors?.filter(a => a.role === 'artist').map(a => a.name).join(', ') || undefined,
      genre: genres.join(', ') || undefined,
      status:
        status === 'ongoing'
          ? 1
          : status === 'completed' || status === 'oneshot'
            ? 0
            : status === 'dropped'
              ? 2
              : status === 'hiatus'
                ? 3
                : undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const filter = this.seriesFilter(mangaUrl);
    const rows = (await this.apiSeries({
      select:
        'chapters(id,chapter_number,volume_number,title,published_at,created_at)',
      [filter.key]: `eq.${filter.value}`,
      'chapters.pages_ready': 'eq.true',
      'chapters.order': 'chapter_number.desc',
    })) as { chapters: SeriesDetailsDto['chapters'] }[];
    const chapters = rows[0]?.chapters;
    if (!chapters) return [];
    return chapters.map(ch => {
      const number = String(ch.chapter_number).replace(/\.0$/, '');
      const nameParts: string[] = [];
      if (ch.volume_number != null) {
        nameParts.push(`Vol. ${String(ch.volume_number).replace(/\.0$/, '')} `);
      }
      nameParts.push(`Ch. ${number}`);
      if (ch.title) nameParts.push(`: ${ch.title}`);
      return {
        name: nameParts.join(''),
        url: ch.id,
        chapterNumber: ch.chapter_number,
        dateUpload: Date.parse(ch.published_at || ch.created_at) || undefined,
      };
    });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const url = new URL(`${API_URL}/chapters`);
    url.searchParams.set('select', 'series(is_r18),chapter_pages(object_key)');
    url.searchParams.set('id', `eq.${chapterUrl}`);
    url.searchParams.set('chapter_pages.order', 'page_number.asc');
    const res = await this.get(url.toString(), {
      headers: { Accept: 'application/json', apikey: API_KEY },
    });
    const data = (res.data as ChapterPagesDto[])[0];
    if (!data) return [];
    const imageHost = data.series?.is_r18 ? 'https://img-r18.schalescans.com' : 'https://img.schalescans.com';
    return data.chapter_pages.map((p, i) => ({ imageUrl: `${imageHost}/${p.object_key}`, index: i }));
  }
}

export default SchalescansScraper;
