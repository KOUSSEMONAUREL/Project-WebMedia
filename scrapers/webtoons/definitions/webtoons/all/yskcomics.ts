import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface ResponseDto<T> {
  data: T;
}

interface ResponseInnerDto<T> {
  data_messages: T[];
  meta: PageMeta;
}

interface PageMeta {
  link_next: string | null;
}

interface NamedEntity {
  name: string;
}

interface MangaPopularRaw {
  image: string;
  full_name: string;
  slug: string;
  rate: string;
  writer: NamedEntity;
  publisher: NamedEntity;
  genres: NamedEntity[];
  descrition: string;
}

interface MangaLatestRaw {
  image: string;
  full_name: string;
  slug: string;
  rate: string;
  rate_count: number;
  writer: string;
  genres: NamedEntity[];
}

interface MangaSearchRaw {
  full_name: string;
  slug: string;
  image: string;
}

interface DetailsRaw {
  full_name: string;
  slug: string;
  image: string;
  rate: string;
  rate_count: number;
  language_code: string;
  writer: NamedEntity;
  publisher: NamedEntity;
  genres: NamedEntity[];
  artists: NamedEntity[];
  status: string;
  description: string;
  published_at: string;
}

interface ChapterRaw {
  slug: string;
  rank: string;
}

function getRatingString(rate: string, rateCount: number): string {
  const ratingValue = parseFloat(rate) || 0;
  let ratingStar: string;
  if (ratingValue >= 4.75) ratingStar = '★★★★★';
  else if (ratingValue >= 4.25) ratingStar = '★★★★✬';
  else if (ratingValue >= 3.75) ratingStar = '★★★★☆';
  else if (ratingValue >= 3.25) ratingStar = '★★★✬☆';
  else if (ratingValue >= 2.75) ratingStar = '★★★☆☆';
  else if (ratingValue >= 2.25) ratingStar = '★★✬☆☆';
  else if (ratingValue >= 1.75) ratingStar = '★★☆☆☆';
  else if (ratingValue >= 1.25) ratingStar = '★✬☆☆☆';
  else if (ratingValue >= 0.75) ratingStar = '★☆☆☆☆';
  else if (ratingValue >= 0.25) ratingStar = '✬☆☆☆☆';
  else ratingStar = '☆☆☆☆☆';
  if (ratingValue > 0) {
    return rateCount > 0 ? `${ratingStar} ${rate} (${rateCount})` : `${ratingStar} ${rate}`;
  }
  return '';
}

export class YskComicsScraper extends BaseScraper {
  readonly name = 'YSK Comics';
  readonly baseUrl = 'https://www.ysk-comics.com';
  readonly lang = 'all';

  private readonly apiBaseUrl = 'https://api.ysk-comics.com';
  // Upstream ships per-lang sources (ar/en); this 'all' port uses the site
  // default locale for URL paths and the x-localization header.
  private readonly siteLang = 'en';

  private localizationHeaders(): { headers: Record<string, string> } {
    return { headers: { 'x-localization': this.siteLang } };
  }

  async getPopular(): Promise<SearchResult> {
    const response = await this.get(`${this.baseUrl}/api/home/best-comics`, this.localizationHeaders());
    const body = response.data as ResponseDto<MangaPopularRaw[]>;
    return { mangas: body.data.map(item => this.popularToManga(item)), hasNextPage: false };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const response = await this.get(`${this.baseUrl}/api/home/latest-comics?page=${page}`, this.localizationHeaders());
    const body = response.data as ResponseDto<ResponseInnerDto<MangaLatestRaw>>;
    return {
      mangas: body.data.data_messages.map(item => this.latestToManga(item)),
      hasNextPage: body.data.meta.link_next != null,
    };
  }

  async getSearch(query: string): Promise<SearchResult> {
    if (query.trim().length < 3) throw new Error('Search query must be at least 3 characters');
    const url = new URL(`${this.apiBaseUrl}/api/v1/search-comics-home`);
    url.searchParams.set('name', query);
    const response = await this.get(url.toString(), this.localizationHeaders());
    const body = response.data as ResponseDto<MangaSearchRaw[]>;
    return { mangas: body.data.map(item => this.searchToManga(item)), hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = this.extractSlug(mangaUrl);
    const response = await this.get(`${this.baseUrl}/api/comic/${slug}`, this.localizationHeaders());
    const body = response.data as ResponseDto<DetailsRaw>;
    return this.detailsToManga(body.data);
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = this.extractSlug(mangaUrl);
    const chapters: Chapter[] = [];
    let page = 1;
    let hasNext = true;
    while (hasNext) {
      const response = await this.get(
        `${this.baseUrl}/api/comic/chapter/${slug}?page=${page}`,
        this.localizationHeaders(),
      );
      const body = response.data as ResponseDto<ResponseInnerDto<ChapterRaw>>;
      for (const item of body.data.data_messages) {
        chapters.push({ url: `/${this.siteLang}/chapter/${item.slug}`, name: `#${item.rank}` });
      }
      hasNext = body.data.meta.link_next != null;
      page++;
    }
    return chapters.reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const slug = this.extractSlug(chapterUrl);
    const response = await this.get(
      `${this.baseUrl}/api/chapters/images/${slug}`,
      this.localizationHeaders(),
    );
    const body = response.data as ResponseDto<string[]>;
    return body.data.map((imageUrl, index) => ({ index, imageUrl }));
  }

  private popularToManga(raw: MangaPopularRaw): Manga {
    const ratingStr = getRatingString(raw.rate, 0);
    const description = `${ratingStr ? `${ratingStr}\n` : ''}Publisher: ${raw.publisher.name}\n\n${this.plainText(raw.descrition)}`;
    return {
      url: `/${this.siteLang}/comic/${raw.slug}`,
      title: raw.full_name,
      author: raw.writer.name,
      description,
      genre: raw.genres.map(g => g.name).join(', '),
      status: 0,
      thumbnailUrl: raw.image,
      lang: this.lang,
    };
  }

  private latestToManga(raw: MangaLatestRaw): Manga {
    return {
      url: `/${this.siteLang}/comic/${raw.slug}`,
      title: raw.full_name,
      author: raw.writer,
      description: getRatingString(raw.rate, raw.rate_count),
      genre: raw.genres.map(g => g.name).join(', '),
      status: 0,
      thumbnailUrl: raw.image,
      lang: this.lang,
    };
  }

  private searchToManga(raw: MangaSearchRaw): Manga {
    return {
      url: `/${this.siteLang}/comic/${raw.slug}`,
      title: raw.full_name,
      status: 0,
      thumbnailUrl: raw.image,
      lang: this.lang,
    };
  }

  private detailsToManga(raw: DetailsRaw): Partial<Manga> {
    const ratingStr = getRatingString(raw.rate, raw.rate_count);
    const description = `${ratingStr ? `${ratingStr}\n` : ''}Publisher: ${raw.publisher.name}\nPublished at: ${raw.published_at}\n\n${this.plainText(raw.description)}`;
    return {
      url: `/${this.siteLang}/comic/${raw.slug}`,
      title: raw.full_name,
      artist: raw.artists.map(a => a.name).join(', '),
      author: raw.writer.name,
      description,
      genre: raw.genres.map(g => g.name).join(', '),
      status: raw.status === 'ongoing' ? 1 : raw.status === 'completed' ? 2 : 0,
      thumbnailUrl: raw.image,
    };
  }

  private plainText(html: string): string {
    return this.$(html).text().trim();
  }

  private extractSlug(path: string): string {
    const absolute = this.absUrl(path);
    const segments = new URL(absolute).pathname.split('/').filter(Boolean);
    const slug = segments[segments.length - 1];
    if (!slug) throw new Error(`Unable to parse URL:\n${absolute}`);
    return slug;
  }
}
