import type { AxiosResponseHeaders } from 'axios';
import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, MangaStatus, Page, SearchResult } from '../../../engine/types';

interface LivewireUpdate {
  components?: Array<{ snapshot?: string | null }>;
}

function parseStatus(text: string | undefined): MangaStatus {
  switch (text?.trim().toLowerCase()) {
    case 'on going':
    case 'ongoing':
    case 'currently publishing':
      return 1;
    case 'completed':
    case 'finished':
      return 0;
    case 'on hiatus':
      return 3;
    case 'discontinued':
    case 'cancelled':
      return 2;
    default:
      return undefined;
  }
}

function cookieHeader(headers: AxiosResponseHeaders): string {
  const raw = (headers as unknown as Record<string, unknown>)['set-cookie'];
  if (Array.isArray(raw)) return raw.map(value => String(value).split(';')[0]).join('; ');
  if (typeof raw === 'string') return raw.split(';')[0];
  return '';
}

export class ManhwaZoneScraper extends BaseScraper {
  readonly name = 'ManhwaZone';
  readonly baseUrl = 'https://manhwazone.com';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    return this.list(`/series?sortBy=popularity&page=${page}`);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.list(`/series?sortBy=latest&page=${page}`);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const params = new URLSearchParams({ page: String(page) });
    if (query.trim()) params.set('keyword', query.trim());
    else params.set('sortBy', 'latest');
    return this.list(`/series?${params.toString()}`);
  }

  private async list(path: string): Promise<SearchResult> {
    const res = await this.get(path);
    const $ = this.$(String(res.data));
    const mangas: Manga[] = [];
    $('article.group').each((_i, el) => {
      const $el = $(el);
      const $link = $el.find('.min-w-0 > a.font-semibold').first();
      const href = $el.find('a').first().attr('href');
      if (!href) return;
      const title = $link.text().trim();
      if (!title) return;
      const thumb = $el.find('img').first().attr('src') ?? '';
      mangas.push({
        title,
        url: this.absUrl(href),
        thumbnailUrl: thumb,
        lang: this.lang,
      });
    });
    const hasNextPage = $('a[rel=next], nav a:contains("›")').length > 0 || mangas.length >= 24;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(String(res.data));
    const title = $('h1.page-title').first().text().trim();
    const thumbnail = $('figure.relative img, img[class*="aspect"]').first().attr('src') ?? '';
    const genre = $('a.badge-genre').map((_i, el) => $(el).text()).get().join(', ');
    const statusText = $('span.badge-sm, span:contains("On Going"), span:contains("Completed")').first().text().trim();
    const jsonLd = $('script[type="application/ld+json"]').first().text();
    const authorMatch = /"author":\s*\[\s*\{"@type":"Person","name":"([^"]+)"/.exec(jsonLd);
    return {
      title,
      thumbnailUrl: thumbnail,
      description: $('p.page-subtitle').first().text().trim() || undefined,
      genre: genre || undefined,
      author: authorMatch?.[1] && authorMatch[1].toLowerCase() !== 'unknown' ? authorMatch[1] : undefined,
      status: parseStatus(statusText),
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(String(res.data));
    const $wire = $('div[wire\\:snapshot]').filter((_i, el) => $(el).attr('wire:init') === 'bootLoad').first();
    if ($wire.length === 0) return [];
    const snapshot = $wire.attr('wire:snapshot');
    if (!snapshot) return [];
    const token = $('meta[name="csrf-token"]').attr('content') ?? '';
    const cookie = cookieHeader(res.headers as AxiosResponseHeaders);
    const body = {
      _token: token,
      components: [{
        snapshot,
        updates: {},
        calls: [{ path: '', method: 'bootLoad', params: [] }],
      }],
    };
    const update = await this.post(`${this.baseUrl}/livewire/update`, body, {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Livewire': 'true',
        'X-CSRF-TOKEN': token,
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });
    const response = update.data as LivewireUpdate;
    const snapshotString = response.components?.[0]?.snapshot;
    if (!snapshotString) return [];
    let parsed: { data?: { chapters?: unknown } };
    try {
      parsed = JSON.parse(snapshotString) as { data?: { chapters?: unknown } };
    } catch {
      return [];
    }
    const chaptersContainer = parsed.data?.chapters;
    if (!Array.isArray(chaptersContainer)) return [];
    const tuples = chaptersContainer[0];
    if (!Array.isArray(tuples)) return [];
    const chapters: Chapter[] = [];
    for (const tuple of tuples) {
      if (!Array.isArray(tuple)) continue;
      const item = tuple[0];
      if (!item || typeof item !== 'object') continue;
      const chapter = item as Record<string, unknown>;
      const webUrl = typeof chapter.web_url === 'string' ? chapter.web_url : undefined;
      if (!webUrl) continue;
      const name = typeof chapter.name === 'string' ? chapter.name : 'Chapter';
      const published = typeof chapter.published === 'string' ? chapter.published : undefined;
      const dateUpload = published ? Date.parse(published.replace(' ', 'T')) : undefined;
      chapters.push({
        name,
        url: this.absUrl(webUrl),
        dateUpload: Number.isNaN(dateUpload) ? undefined : dateUpload,
      });
    }
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(this.absUrl(chapterUrl));
    const $ = this.$(String(res.data));
    return $('img.lazy-image[data-src]')
      .map((_i, el) => $(el).attr('data-src') ?? '')
      .get()
      .filter(url => url.length > 0)
      .map((imageUrl, index) => ({ index, imageUrl: this.absUrl(imageUrl) }));
  }
}
