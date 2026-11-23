import type { CheerioAPI } from 'cheerio';
import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

interface WixPage {
  title: string;
  pageUriSEO: string;
}

interface ViewerModel {
  siteFeaturesConfigs?: {
    router?: {
      pagesMap?: Record<string, WixPage>;
    };
  };
}

interface Comic {
  manga: Manga;
  names: string[];
}

const MEDIA_URL = 'https://static.wixstatic.com/media';
const SEX_THERAPY_PATH = '/sextherapy';
const SEX_THERAPY_COVER =
  `${MEDIA_URL}/b0c0d6_ee71b25cbc554d6596e29122c078d1a4~mv2_d_4302_6072_s_4_2.jpg/v1/fit/w_600,h_900,q_90/cover.jpg`;

export class CathexisScraper extends BaseScraper {
  readonly name = 'Cathexis';
  readonly baseUrl = 'https://www.cathexis.world';
  readonly lang = 'en';

  async getPopular(): Promise<SearchResult> {
    return { mangas: (await this.fetchComics()).map(comic => comic.manga), hasNextPage: false };
  }

  async getLatest(): Promise<SearchResult> {
    return { mangas: [], hasNextPage: false };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (page > 1) return { mangas: [], hasNextPage: false };

    if (/^https?:\/\//.test(query)) {
      const parsed = new URL(query);
      if (!parsed.hostname.endsWith('cathexis.world')) throw new Error('Unsupported url');
      const comics = await this.fetchComics();
      const path = `/${parsed.pathname.split('/').filter(Boolean)[0] || ''}`;
      const direct = comics.find(comic => comic.manga.url === path);
      if (direct) return { mangas: [direct.manga], hasNextPage: false };

      const sexTherapy = comics.find(comic => comic.manga.url === SEX_THERAPY_PATH);
      if (sexTherapy && path.startsWith('/sex-therapy-session-')) {
        return { mangas: [sexTherapy.manga], hasNextPage: false };
      }
      throw new Error('Unsupported url');
    }

    const needle = query.trim().toLowerCase();
    const mangas = (await this.fetchComics())
      .filter(comic => comic.names.some(name => name.toLowerCase().includes(needle)))
      .map(comic => comic.manga);
    return { mangas, hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const $ = this.$(await this.html(mangaUrl));
    const titles = this.pageTitles($);
    const path = new URL(this.absUrl(mangaUrl)).pathname.replace(/^\//, '');
    return {
      url: this.absUrl(mangaUrl),
      title: titles[path] || $('h1').first().text().trim(),
      thumbnailUrl: this.mediaUrl($('.wixui-image img').first().attr('src') || ''),
      author: 'Cathexis',
      artist: 'Cathexis',
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const url = this.absUrl(mangaUrl);
    const $ = this.$(await this.html(url));
    const buttons = $('.wixui-repeater__item .wixui-button');
    const links = buttons.filter((_, el) => !!$(el).attr('href'));

    if (links.length === 0) {
      return [{ name: 'Chapter', url }];
    }

    return links.toArray().map(el => {
      const $el = $(el);
      return {
        name: $el.text().trim(),
        url: this.absUrl($el.attr('href') || ''),
      };
    }).sort((a, b) => {
      const an = Number(a.name.match(/\d+(?:\.\d+)?/)?.[0] || 0);
      const bn = Number(b.name.match(/\d+(?:\.\d+)?/)?.[0] || 0);
      return bn - an;
    });
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const $ = this.$(await this.html(chapterUrl));
    return $('#PAGES_CONTAINER .wixui-image img').toArray().map((el, index) => ({
      index,
      imageUrl: this.mediaUrl($(el).attr('src') || ''),
    })).filter(page => page.imageUrl);
  }

  private async html(path: string): Promise<string> {
    const res = await this.get(path);
    return String(res.data);
  }

  private pageTitles($: CheerioAPI): Record<string, string> {
    const raw = $('script#wix-viewer-model').text();
    if (!raw) return {};
    try {
      const model = JSON.parse(raw) as ViewerModel;
      const pages = model.siteFeaturesConfigs?.router?.pagesMap || {};
      return Object.fromEntries(
        Object.values(pages).map(page => [page.pageUriSEO, page.title.trim()]),
      );
    } catch {
      return {};
    }
  }

  private async fetchComics(): Promise<Comic[]> {
    const $ = this.$(await this.html('/fan-comics'));
    const titles = this.pageTitles($);
    const comics: Comic[] = [];

    const sexTitle = titles[SEX_THERAPY_PATH.slice(1)];
    if (sexTitle) {
      comics.push({
        manga: {
          title: sexTitle,
          url: SEX_THERAPY_PATH,
          thumbnailUrl: SEX_THERAPY_COVER,
          lang: this.lang,
        },
        names: [sexTitle],
      });
    }

    $('.wixui-repeater__item:has(a.wixui-button[href])').each((_, el) => {
      const $item = $(el);
      const link = $item.find('a.wixui-button[href]').first();
      const path = new URL(this.absUrl(link.attr('href') || '')).pathname;
      const title = titles[path.slice(1)];
      if (!title) return;
      comics.push({
        manga: {
          title,
          url: path,
          thumbnailUrl: this.mediaUrl($item.find('img').first().attr('src') || ''),
          lang: this.lang,
        },
        names: [title, link.text().trim()],
      });
    });

    return comics;
  }

  private mediaUrl(src: string): string {
    if (!src) return '';
    const absolute = this.absUrl(src);
    const segments = new URL(absolute).pathname.split('/').filter(Boolean);
    return segments[1] ? `${MEDIA_URL}/${segments[1]}` : '';
  }
}
