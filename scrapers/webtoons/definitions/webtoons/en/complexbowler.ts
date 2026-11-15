import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, MangaStatus, Page, SearchResult } from '../../../engine/types';

interface ImgchestFile {
  link: string;
  position: number;
}

interface ImgchestPage {
  props?: {
    post?: {
      files?: ImgchestFile[];
    };
  };
}

export class ComplexBowlerScraper extends BaseScraper {
  readonly name = 'Complex Bowler';
  readonly baseUrl = 'https://complexbowler.neocities.org';
  readonly lang = 'en';

  private toStatus(text: string | undefined): MangaStatus {
    switch ((text ?? '').trim().toLowerCase()) {
      case 'ongoing projects':
        return 1;
      case 'completed projects':
        return 0;
      default:
        return 3;
    }
  }

  private parseProjects(html: string): Manga[] {
    const $ = this.$(html);
    return $('.project-section')
      .toArray()
      .flatMap(section => {
        const $section = $(section);
        const status = this.toStatus($section.find('h2').first().text());
        return $section
          .find('a:has(> img)')
          .toArray()
          .map(element => {
            const link = $(element);
            const href = link.attr('href') ?? '';
            const image = link.find('img').first();
            const title = (image.attr('alt') ?? '').trim();
            if (!href || !title) return undefined;
            return {
              title,
              url: this.absUrl(href),
              thumbnailUrl: this.absUrl(image.attr('src') ?? ''),
              status,
              lang: this.lang,
            } as Manga;
          })
          .filter((manga): manga is Manga => Boolean(manga));
      });
  }

  async getPopular(_page = 1): Promise<SearchResult> {
    const res = await this.get(this.baseUrl);
    return { mangas: this.parseProjects(String(res.data)), hasNextPage: false };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getPopular(page);
  }

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const term = query.trim().toLowerCase();
    const { mangas } = await this.getPopular();
    if (!term) return { mangas, hasNextPage: false };
    return { mangas: mangas.filter(manga => manga.title.toLowerCase().includes(term)), hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const url = this.absUrl(mangaUrl);
    const [listed, res] = await Promise.all([this.getPopular(), this.get(url)]);
    const listedManga = listed.mangas.find(manga => manga.url === url);
    const $ = this.$(String(res.data));
    const section = $('.project-section').first();
    const title = section.find('h2').first().text().trim() || listedManga?.title;
    const description = section
      .children('p')
      .toArray()
      .map(element => $(element).text().trim())
      .filter(Boolean)
      .join('\n\n');

    return {
      title: title || undefined,
      url,
      thumbnailUrl: listedManga?.thumbnailUrl,
      description: description || undefined,
      status: listedManga?.status ?? 3,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(this.absUrl(mangaUrl));
    const $ = this.$(String(res.data));
    return $('.project-section .chapter-list li a')
      .toArray()
      .map(element => {
        const link = $(element);
        const href = link.attr('href') ?? '';
        const name = link.text().trim();
        if (!href || !name) return undefined;
        return { name, url: this.absUrl(href) } as Chapter;
      })
      .filter((chapter): chapter is Chapter => Boolean(chapter));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const url = new URL(this.absUrl(chapterUrl));
    if (url.hostname !== new URL(this.baseUrl).hostname) {
      if (url.hostname === 'cubari.moe' && url.pathname.startsWith('/read/imgchest/')) {
        const album = url.pathname.split('/')[3];
        const res = await this.get(`https://imgchest.com/p/${album}`);
        const $ = this.$(String(res.data));
        const data = $('div#app').first().attr('data-page');
        if (!data) return [];
        const parsed = JSON.parse(data) as ImgchestPage;
        return (parsed.props?.post?.files ?? [])
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((file, index) => ({ index, imageUrl: file.link }));
      }
      return [];
    }

    const res = await this.get(url.toString());
    const $ = this.$(String(res.data));
    const script = $('script')
      .toArray()
      .map(element => $(element).text())
      .find(text => text.includes('input_images')) ?? '';
    const block = /input_images\s*=\s*\[([^\]]*)]/.exec(script)?.[1] ?? '';
    return [...block.matchAll(/"([^"]+)"/g)].map((match, index) => ({
      index,
      imageUrl: match[1],
    }));
  }
}
