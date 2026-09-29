import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const CHARACTER_SUMMARY_SLUG = 'comic-characters';

export class BroccoliSoupScraper extends BaseScraper {
  readonly name = 'Broccoli Soup';
  readonly baseUrl = 'https://politeandgood.com';
  readonly lang = 'en';

  private createManga(): Manga {
    return {
      title: 'Broccoli Soup',
      url: '/comic/archive',
      thumbnailUrl: 'https://politeandgood.com/assets/images/static/Bocki%20(correct%20size).png',
      lang: this.lang,
      author: 'Secret Pie',
      artist: 'Secret Pie',
      description:
        ' Hello there! How is the Weather? This comic is made by me, Secret Pie. I am a pie with legs who draws comics and makes music. I am also an entomologist.',
      status: 1,
    };
  }

  async getPopular(): Promise<SearchResult> {
    return { mangas: [this.createManga()], hasNextPage: false };
  }

  async getSearch(): Promise<SearchResult> {
    return { mangas: [], hasNextPage: false };
  }

  async getMangaDetails(): Promise<Partial<Manga>> {
    return this.createManga();
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const response = await this.get(mangaUrl);
    const $ = this.$(response.data);
    const arcIndex = new Map<string, number>();
    const chapters: Chapter[] = [
      { name: 'Characters', url: `/${CHARACTER_SUMMARY_SLUG}`, chapterNumber: 0 },
    ];
    $('li.archive-marker').each((_, group: any) => {
      const $group = $(group);
      const arcTitle = $group.find('.archive-header .marker-title').first().text() || undefined;
      $group.find('li.archive-page').each((_, item: any) => {
        const $item = $(item);
        const $link = $item.find('a').first();
        if ($link.length === 0) return;
        const $title = $link.find('span.page-title').first();
        if ($title.length === 0) return;
        const url = $link.attr('href') ?? '';
        const chapterNumber = parseInt(url.substring(url.lastIndexOf('/') + 1), 10);
        const hasNumber = !Number.isNaN(chapterNumber);
        const parts: string[] = [];
        if (hasNumber) parts.push(`${chapterNumber}:`);
        parts.push($title.text());
        if (arcTitle) {
          const nextIndex = 1 + (arcIndex.get(arcTitle) ?? 0);
          arcIndex.set(arcTitle, nextIndex);
          parts.push(`(${arcTitle} #${nextIndex})`);
        }
        chapters.push({
          url,
          name: parts.join(' '),
          chapterNumber: hasNumber ? chapterNumber : undefined,
        });
      });
    });
    chapters.reverse();
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const response = await this.get(chapterUrl);
    const segments = (response.request?.responseURL ?? this.absUrl(chapterUrl))
      .split('?')[0]
      .split('/')
      .filter(Boolean);
    const $ = this.$(response.data);
    if (segments[segments.length - 1] === CHARACTER_SUMMARY_SLUG) {
      return this.parseCharacterSummary(response.data);
    }
    return $('#comic img')
      .toArray()
      .map((el, index) => ({ index, imageUrl: this.absUrl($(el).attr('src') ?? '') }));
  }

  private parseCharacterSummary(html: string): Page[] {
    const $ = this.$(html);
    const pages: Page[] = [];
    $('section.static-block')
      .filter((_, el: any) => $(el).find('figure, .block-content').length > 0)
      .each((_, section: any) => {
        const $section = $(section);
        const headerText = $section.children('h1, h2, h3, h4').first().text()?.trim();
        const bodyText = $section.find('div.block-content').first().text()?.trim();
        const imageUrl = $section.find('figure img').first().attr('src');
        if (headerText || bodyText) {
          pages.push({
            index: pages.length,
            imageUrl: this.textPageDataUrl(headerText ?? '', bodyText ?? ''),
          });
        }
        if (imageUrl) {
          pages.push({ index: pages.length, imageUrl: this.absUrl(imageUrl) });
        }
      });
    return pages;
  }

  private textPageDataUrl(header: string, body: string): string {
    const escape = (s: string): string =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const lines: string[] = [];
    let remaining = body.replace(/\s+/g, ' ').trim();
    while (remaining.length > 60) {
      let cut = remaining.lastIndexOf(' ', 60);
      if (cut <= 0) cut = 60;
      lines.push(remaining.substring(0, cut));
      remaining = remaining.substring(cut).trim();
    }
    if (remaining) lines.push(remaining);
    const textElements = lines
      .map((line, i) => `  <text x="40" y="${160 + i * 32}" font-size="24">${escape(line)}</text>`)
      .join('\n');
    const height = Math.max(320, 200 + lines.length * 32);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${height}">` +
      `<rect width="100%" height="100%" fill="white"/>` +
      `<g font-family="sans-serif" fill="black">` +
      `<text x="40" y="80" font-size="36" font-weight="bold">${escape(header)}</text>\n` +
      `${textElements}</g></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }
}
