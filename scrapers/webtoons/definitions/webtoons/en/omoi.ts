import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

// Transcompilation of keiyoushi `en/omoi` (Azuki.kt + Dto.kt): the same Azuki
// backend as `en/kodansha` under a different organization key. The catalogue
// is server-rendered HTML (`/discover?sort=<popular|recent_series|alphabetical>&page=N`,
// `ol.o-series-card-list li` with `a.a-card-link[data-ga-item-id="series-<uuid>"]`);
// details, chapters and pages come from `production.api.azuki.co`.
// Series URLs are `/series/<slug>` and `manga.url` is `<slug>#<uuid>`;
// `chapter.url` is `<chapterUuid>#<slug>`. Page images are high-res WebP with
// `?drm=1` — returned verbatim, like `kodansha.ts` the XOR descrambling (key
// 174, reader-side only) has no impact on the ingested series URL.

const API_URL = 'https://production.api.azuki.co';
const ORGANIZATION_KEY = '199e5a19-a236-49f5-81f4-43d4a541748a';

interface WebpDto {
  url: string;
  width: number;
}

interface ImageDto {
  webp: WebpDto[];
}

interface DetailsDto {
  slug: string;
  uuid: string;
  name: string;
  short_description?: string | null;
  is_complete?: boolean | null;
  image?: ImageDto | null;
  tags?: string[] | null;
  creators?: { name: string }[] | null;
  credits?: string | null;
  release_schedule?: string | null;
  alt_titles?: { name: string }[] | null;
}

interface ChapterItemDto {
  uuid: string;
  title?: string | null;
  label: string;
  release_date?: string | null;
  free_published_date?: string | null;
  free_unpublished_date?: string | null;
  is_upcoming?: boolean | null;
}

interface ChapterListDto {
  chapters: ChapterItemDto[];
}

interface PageListDto {
  data: {
    pages: { image: ImageDto }[];
  };
}

function maxWidthUrl(image: ImageDto | null | undefined): string {
  if (!image || !Array.isArray(image.webp) || image.webp.length === 0) return '';
  let best = image.webp[0];
  for (const size of image.webp) {
    if (size.width > best.width) best = size;
  }
  return best.url;
}

function parseInstant(value: string | null | undefined): number {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

function isChapterFree(dto: ChapterItemDto, now: number): boolean {
  const start = parseInstant(dto.free_published_date);
  if (!(start >= 1 && start <= now)) return false;
  const end = parseInstant(dto.free_unpublished_date);
  return end === 0 || end > now;
}

export class OmoiScraper extends BaseScraper {
  readonly name = 'Omoi';
  readonly baseUrl = 'https://www.omoi.com';
  readonly lang = 'en';

  private apiHeaders(): Record<string, string> {
    return { 'azuki-organization-key': ORGANIZATION_KEY };
  }

  private parseDiscover(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('ol.o-series-card-list li').each((_i, element) => {
      const $el = $(element);
      const link = $el.find('a.a-card-link').first();
      const href = link.attr('href');
      if (!href) return;
      const slug = href.split('/').filter(Boolean).pop() ?? '';
      if (!slug) return;
      const uuid = (link.attr('data-ga-item-id') ?? '').replace(/^series-/, '');
      const title = link.text().replace(/\s+/g, ' ').trim();
      if (!title) return;
      const thumb = $el.find('img').first().attr('src') ?? '';
      mangas.push({
        title,
        url: uuid ? `${slug}#${uuid}` : slug,
        thumbnailUrl: thumb ? this.absUrl(thumb) : '',
        lang: this.lang,
      });
    });
    return { mangas, hasNextPage: $('a[rel="next"]').length > 0 };
  }

  private async discover(page: number, sort: string, query?: string): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/discover`);
    url.searchParams.set('sort', sort);
    url.searchParams.set('page', String(page));
    if (query?.trim()) url.searchParams.set('q', query.trim());
    const res = await this.get(url.toString());
    return this.parseDiscover(res.data as string);
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.discover(page, 'popular');
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.discover(page, 'recent_series');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this.discover(page, 'popular', query);
  }

  private slugAndUuid(mangaUrl: string): { slug: string; uuid: string } {
    const tail = mangaUrl.split('/').filter(Boolean).pop() ?? mangaUrl;
    const [slug, uuid] = tail.split('#');
    return { slug: slug ?? '', uuid: uuid ?? '' };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const { slug } = this.slugAndUuid(mangaUrl);
    if (!slug) return { url: mangaUrl, lang: this.lang };
    const res = await this.get(`${API_URL}/manga/slug/${encodeURIComponent(slug)}/v0`, {
      headers: this.apiHeaders(),
    });
    const dto = res.data as DetailsDto;
    const descriptionParts: string[] = [];
    if (dto.short_description) descriptionParts.push(dto.short_description);
    if (dto.credits?.trim()) descriptionParts.push(dto.credits.trim());
    if (dto.alt_titles && dto.alt_titles.length > 0) {
      descriptionParts.push(`Alternative Titles:\n${dto.alt_titles.map((t) => t.name).join('\n')}`);
    }
    if (dto.release_schedule?.trim()) descriptionParts.push(dto.release_schedule.trim());
    return {
      title: dto.name,
      url: `${dto.slug}#${dto.uuid}`,
      thumbnailUrl: maxWidthUrl(dto.image).replace(/\/\d+_/, '/2400_'),
      description: descriptionParts.join('\n\n').trim() || undefined,
      author: (dto.creators ?? []).map((c) => c.name).join(', ') || undefined,
      genre: (dto.tags ?? []).join(', ') || undefined,
      status: dto.is_complete === true ? 0 : 1,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const { slug, uuid } = this.slugAndUuid(mangaUrl);
    if (!slug || !uuid) return [];
    const params = new URLSearchParams({ order: 'ascending', count: '1000' });
    const res = await this.get(`${API_URL}/mangas/${encodeURIComponent(uuid)}/chapters/v4?${params.toString()}`, {
      headers: this.apiHeaders(),
    });
    const now = Date.now();
    return ((res.data as ChapterListDto).chapters ?? []).map((dto) => {
      const base = `Chapter ${dto.label}`;
      const full = dto.title?.trim() ? `${base} - ${dto.title.trim()}` : base;
      const upcoming = dto.is_upcoming === true ? `${full} - [Upcoming]` : full;
      return {
        name: isChapterFree(dto, now) ? upcoming : `🔒 ${upcoming}`,
        url: `${dto.uuid}#${slug}`,
        dateUpload: parseInstant(dto.release_date) || undefined,
      } as Chapter;
    }).reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const uuid = chapterUrl.split('#')[0]?.split('/').filter(Boolean).pop() ?? '';
    if (!uuid) return [];
    const res = await this.get(`${API_URL}/chapters/${encodeURIComponent(uuid)}/pages/v1`, {
      headers: this.apiHeaders(),
    });
    return (((res.data as PageListDto).data?.pages ?? []).map((page, index) => {
      const highRes = page.image.webp.length > 0
        ? page.image.webp.reduce((a, b) => (b.width > a.width ? b : a))
        : null;
      const url = (highRes?.url ?? '').replace(/\/\d+_/, '/2400_');
      return { index, imageUrl: url ? `${url}?drm=1` : '' };
    }));
  }
}
