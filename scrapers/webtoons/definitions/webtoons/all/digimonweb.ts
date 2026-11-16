import type { CheerioAPI } from 'cheerio';
import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

const COMIC_PATH = '/digimoncomic/';
const DREAMERS_PATH = '/digimondreamers/';
const AWARD_PATH = '/digimon_comicaward2023/';

const COMIC_KEY_REGEX = /\/comic\/([^/]+)\/ep_/;
const PAGE_REGEX = /\/img_comic_(\d+)\./;

interface DigimonWork {
  manga: Manga;
  chapters: Chapter[];
}

export class DigimonWebScraper extends BaseScraper {
  readonly name = 'Digimon Web';
  readonly baseUrl = 'https://digimon.net';
  readonly lang = 'all';

  private get catalogPages(): string[] {
    return [
      COMIC_PATH,
      `${COMIC_PATH}en/`,
      DREAMERS_PATH,
      `${DREAMERS_PATH}en/`,
      `${DREAMERS_PATH}cn/`,
      AWARD_PATH,
    ];
  }

  async getPopular(): Promise<SearchResult> {
    const pages = await Promise.allSettled(this.catalogPages.map(path => this.getWorks(path)));
    const works = pages.flatMap(result => result.status === 'fulfilled' ? result.value : []);
    const seen = new Set<string>();
    const mangas = works.map(work => work.manga).filter(manga => {
      if (seen.has(manga.url)) return false;
      seen.add(manga.url);
      return true;
    });
    return { mangas, hasNextPage: false };
  }

  async getSearch(query: string): Promise<SearchResult> {
    const all = await this.getPopular();
    const needle = query.trim().toLowerCase();
    return {
      mangas: needle ? all.mangas.filter(manga => manga.title.toLowerCase().includes(needle)) : all.mangas,
      hasNextPage: false,
    };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const url = new URL(mangaUrl, this.baseUrl);
    if (url.pathname.startsWith(COMIC_PATH)) {
      const key = url.searchParams.get('work');
      if (!key) return {};
      const works = this.comicWorks(await this.fetchDocument(url.pathname), url.pathname);
      const work = works.find(item => item.manga.url === mangaUrl);
      return work ? { ...work.manga, url: mangaUrl } : {};
    }
    if (url.pathname.startsWith(DREAMERS_PATH)) {
      const work = this.dreamersWork(await this.fetchDocument(url.pathname), url.pathname);
      return { ...work.manga, url: mangaUrl };
    }
    if (url.pathname.startsWith(AWARD_PATH)) {
      const works = this.awardWorks(await this.fetchDocument(AWARD_PATH));
      const work = works.find(item => item.manga.url === mangaUrl);
      return work ? { ...work.manga, url: mangaUrl } : {};
    }
    return {};
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const url = new URL(mangaUrl, this.baseUrl);
    if (url.pathname.startsWith(COMIC_PATH)) {
      const key = url.searchParams.get('work');
      if (!key) return [];
      const works = this.comicWorks(await this.fetchDocument(url.pathname), url.pathname);
      return works.find(item => item.manga.url === mangaUrl)?.chapters ?? [];
    }
    if (url.pathname.startsWith(DREAMERS_PATH)) {
      return this.dreamersWork(await this.fetchDocument(url.pathname), url.pathname).chapters;
    }
    if (url.pathname.startsWith(AWARD_PATH)) {
      const works = this.awardWorks(await this.fetchDocument(AWARD_PATH));
      return works.find(item => item.manga.url === mangaUrl)?.chapters ?? [];
    }
    return [];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const $ = this.$(await this.fetchHtml(chapterUrl));
    return $('img[src*=/img_comic_]').toArray()
      .map(el => {
        const src = $(el).attr('src') || '';
        const match = PAGE_REGEX.exec(src);
        if (!match) return null;
        return { number: Number(match[1]), imageUrl: this.resolve(src, chapterUrl) };
      })
      .filter((page): page is { number: number; imageUrl: string } => page !== null)
      .sort((a, b) => a.number - b.number)
      .map((page, index) => ({ index, imageUrl: page.imageUrl }));
  }

  private async fetchHtml(path: string): Promise<string> {
    return (await this.get(path)).data as string;
  }

  private resolve(href: string, pagePath: string): string {
    return new URL(href, this.absUrl(pagePath)).toString();
  }

  private async fetchDocument(path: string): Promise<CheerioAPI> {
    return this.$(await this.fetchHtml(path));
  }

  private async getWorks(path: string): Promise<DigimonWork[]> {
    const $ = await this.fetchDocument(path);
    if (path.startsWith(COMIC_PATH)) return this.comicWorks($, path);
    if (path.startsWith(DREAMERS_PATH)) return [this.dreamersWork($, path)];
    return this.awardWorks($);
  }

  private comicWorks($: CheerioAPI, path: string): DigimonWork[] {
    return $('div.pg-works__wrap:has(div.pg-works__kv)').toArray().map(el => {
      const work = $(el);
      const episodes = work.find('ul.pg-ep_list a').toArray();
      if (episodes.length === 0) return null;
      const firstHref = episodes[0].attribs.href || '';
      const key = COMIC_KEY_REGEX.exec(new URL(firstHref, this.absUrl(path)).pathname)?.[1] ?? '';
      const image = work.find('div.pg-works__kv img').first();
      const credit = work.closest('div.pg-works').find('p.pg-works_tit__txt').first().text().trim();
      const title = image.attr('alt')?.trim() || work.find('h3.pg-works_tit__tit').first().text().trim();
      const descriptionParts = [
        credit.includes('（') ? credit.split('（')[1]?.replace('）', '').trim() : '',
        work.find('.pg-works_detail__txt').first().text().trim(),
      ].filter(Boolean);
      const manga: Manga = {
        title,
        url: `${this.absUrl(path)}?work=${encodeURIComponent(key)}`,
        thumbnailUrl: this.resolve(image.attr('src') || '', path),
        lang: this.lang,
        author: credit.split('（')[0]?.trim() || undefined,
        description: descriptionParts.join('\n\n') || undefined,
      };
      const chapters = episodes.slice().reverse().map(episode => {
        const link = $(episode);
        return {
          name: link.text().trim(),
          url: this.resolve(link.attr('href') || '', path),
        };
      });
      return { manga, chapters };
    }).filter((work): work is DigimonWork => work !== null);
  }

  private dreamersWork($: CheerioAPI, path: string): DigimonWork {
    const artist = $('.pg-tit__explanation--author dd').first().text().trim();
    const draft = $('.pg-tit__explanation--draft dd').first().text().trim();
    const thumbnail = $('img[src*=img_comic_vol]').first().length > 0
      ? $('img[src*=img_comic_vol]').first()
      : $('h3.pg-tit img').first();
    const manga: Manga = {
      title: $('title').text().split(' | ')[0].trim(),
      url: this.absUrl(path),
      thumbnailUrl: this.resolve(thumbnail.attr('src') || '', path),
      lang: this.lang,
      author: [draft, artist].filter(Boolean).join(', ') || undefined,
      artist: artist || undefined,
      description: $('.pg-intro__text--01').first().text().trim() || undefined,
    };
    const chapters = $('ul.pg-episodesList a').toArray().reverse().map(el => {
      const link = $(el);
      return {
        name: link.text().trim(),
        url: this.resolve(link.attr('href') || '', path),
      };
    });
    return { manga, chapters };
  }

  private awardWorks($: CheerioAPI): DigimonWork[] {
    return $('li.pg-awardList__item:has(div.pg-awardList__kv a)').toArray().map(el => {
      const item = $(el);
      const link = item.find('div.pg-awardList__kv a').first();
      const url = this.resolve(link.attr('href') || '', AWARD_PATH);
      const manga: Manga = {
        title: item.find('div.pg-awardList__tit--01 h5').first().text().trim(),
        url,
        thumbnailUrl: this.resolve(link.find('img').attr('src') || '', AWARD_PATH),
        lang: this.lang,
        author: item.find('div.author').first().text().trim() || undefined,
        description: item.find('.pg-story__content').first().text().trim() || undefined,
        status: 0,
      };
      return {
        manga,
        chapters: [{ name: '読切', url }],
      };
    }).filter(work => work.manga.title && work.manga.url);
  }
}

export default DigimonWebScraper;
