import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, MangaStatus, Page, SearchResult } from '../../../engine/types';

const CHAPTERS_PER_REQUEST = 50;
const READER_REGEX = /MYMANGALIST_READER = (\{.*\});/;

interface ChapterItem {
  label?: string;
  href?: string;
  published_date?: string;
}

interface ChaptersDto {
  group?: { items?: ChapterItem[] };
  next_offset?: number;
  has_more?: boolean;
}

interface ReaderDto {
  pageUrls?: string[];
}

export class MyMangaListScraper extends BaseScraper {
  readonly name = 'MyMangaList';
  readonly baseUrl = 'https://www5.mymangalist.org';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    return this.searchPage(page, 'popular');
  }

  // "Newest" sorts by the latest chapter update
  async getLatest(page = 1): Promise<SearchResult> {
    return this.searchPage(page, 'newest');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this.searchPage(page, '', query.trim());
  }

  private async searchPage(page: number, sort: string, query = ''): Promise<SearchResult> {
    const params = new URLSearchParams({
      content_type: 'Series',
      sort,
      page: String(page),
    });
    if (query) params.set('q', query);
    const res = await this.get(`/advanced-search?${params.toString()}`);
    const $ = this.$(res.data as string);
    const mangas = $('[data-results-feed] a.cardish').toArray().map(el => {
      const card = $(el);
      const title = card.find('.card-copy strong').first().text().trim();
      const url = this.absUrl(card.attr('href') || '');
      const thumbnailUrl = this.absUrl(card.find('img').first().attr('src') || '');
      return { title, url, thumbnailUrl, lang: this.lang };
    }).filter(manga => manga.title && manga.url);
    // The last page keeps an empty link, and later pages repeat it
    const nextPage = $('[data-search-results-shell]').first().attr('data-next-page-url') || '';
    return { mangas, hasNextPage: nextPage.trim().length > 0 };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data as string);
    const title = $('h1.page-heading').first().text().trim();
    const meta = (label: string): string | undefined => {
      const card = $('.meta-grid .meta-card').toArray()
        .find(el => $(el).find('small').first().text().trim() === label);
      const value = card ? $(card).find('strong').first().text().trim() : '';
      return value && value !== '-' ? value : undefined;
    };
    const statusText = meta('Status')?.toLowerCase() ?? '';
    const status: MangaStatus = statusText === 'ongoing' || statusText === 'on-going' || statusText === 'ong' ? 1
      : statusText === 'completed' || statusText === 'complete' || statusText === 'c' ? 0
      : 3;
    const altTitles = ($('p.page-lead').first().text().trim().replace(/^Alternative title:\s*/i, ''))
      .split(',')
      .map(name => name.trim())
      .filter(name => name && name.toLowerCase() !== title.toLowerCase() && [...name].some(char => char !== '?'));
    const story = $('section.panel').toArray()
      .filter(el => $(el).children('h2').first().text().trim() === 'Story Overview')
      .map(el => $(el).find('p').first().text().trim())
      .find(text => text.length > 0);
    const description = [
      [meta('Released'), meta('Direction')].filter(Boolean).length > 0
        ? [meta('Released'), meta('Direction')].filter(Boolean).join(' - ')
        : '',
      story ?? '',
      altTitles.length > 0 ? `Alternative Titles:\n${altTitles.map(name => `- ${name}`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n');
    return {
      title,
      url: mangaUrl,
      thumbnailUrl: this.absUrl($('section.hero img').first().attr('src') || '') || undefined,
      genre: $('.genre-cluster .chip').toArray().map(el => $(el).text().trim()).filter(Boolean).join(', ') || undefined,
      author: meta('Author'),
      artist: meta('Artist'),
      status,
      description: description || undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const series = await this.get(mangaUrl);
    const $ = this.$(series.data as string);
    // Details keep the title permalink the chapters API expects
    const permalink = $('#chapterGroups').first().attr('data-title-permalink') || '';
    if (!permalink) return [];

    const chapters: Chapter[] = [];
    let offset = 0;
    for (;;) {
      const params = new URLSearchParams({
        permalink,
        offset: String(offset),
        limit: String(CHAPTERS_PER_REQUEST),
      });
      const res = await this.get(`/api/titles/chapters.php?${params.toString()}`, {
        headers: { Referer: mangaUrl },
      });
      const data = res.data as ChaptersDto;
      const items = data.group?.items ?? [];
      for (const item of items) {
        const href = item.href?.trim() ?? '';
        if (!href) continue;
        const dateUpload = item.published_date ? Date.parse(item.published_date) : NaN;
        chapters.push({
          name: item.label?.trim() || href,
          url: this.absUrl(href),
          dateUpload: Number.isNaN(dateUpload) ? undefined : dateUpload,
        });
      }
      if (!data.has_more) break;
      const nextOffset = typeof data.next_offset === 'number' ? data.next_offset : offset + items.length;
      if (nextOffset <= offset) break;
      offset = nextOffset;
    }
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const match = READER_REGEX.exec(res.data as string);
    if (!match) return [];
    const reader = JSON.parse(match[1]) as ReaderDto;
    return (reader.pageUrls ?? [])
      .filter(url => typeof url === 'string' && url.length > 0)
      .map((imageUrl, index) => ({ index, imageUrl: this.absUrl(imageUrl) }));
  }
}

export default MyMangaListScraper;
