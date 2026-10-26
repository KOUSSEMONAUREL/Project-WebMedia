import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const AUTHOR_KSBD = 'Abbadon';
const TITLE_KSBD = 'Kill Six Billion Demons';
const DESCRIPTION_KSBD = `Q: What is this all about?
This is a webcomic! It's graphic novel style, meaning it's meant to be read in large chunks, but you can subject yourself to the agony of reading it a couple pages a week!

Q: Do you have a twitter/tumble machine? Just who the hell draws this thing anyway?
A mysterious comics goblin named Abbadon draws this mess. My twitter is @orbitaldropkick, my tumblr is orbitaldropkick.tumblr.com. If you're feeling dangerous, you can e-mail me at ksbdabbadon@gmail.com

Q: A webcomic, eh? When does it update?
Tuesday and Friday evenings (and occasionally weekends). Sometimes it will be up quite late on those days.

Q: Who's this YISUN guy that keeps getting talked about?
Someone has not read their Psalms and Spasms recently!

Q: What's this about suggestions?
KSBD will periodically take suggestions, mostly on characters to stick in the background. You can also stick fanart, character ideas, concepts, and literature in the 'Submit' section up above. You need tumblr for this. If you want to suggest directly, the best way to do it is through the comments section below the comic! A huge chunk of minor characters have been named and inspired by reader comments so far.

Q: Can I buy this book in a more traditional format?
You absolutely can. You can get your hands on a print copy of the first and second books from Image comics in your local comics shop or anywhere else you can get comics. It looks fantastic in print and if you don't like reading stuff online I highly recommend it`.trimEnd();

const MAX_CHAPTER_ARCHIVE_PAGES = 50;

export class KillSixBillionDemons extends BaseScraper {
  readonly name = 'KillSixBillionDemons';
  readonly baseUrl = 'https://killsixbilliondemons.com';
  readonly lang = 'en';

  private async fetchManga(): Promise<Manga | null> {
    const doc = await this.get(this.baseUrl);
    const $ = this.$(doc.data);
    const chapterUrl = $('a[href*="/chapter/"]').first().attr('href') || '';

    if (!chapterUrl) return null;

    return {
      title: TITLE_KSBD,
      url: chapterUrl,
      thumbnailUrl: $('.comic-thumbnail-in-archive a img').first().attr('src') || '',
      lang: this.lang,
      author: AUTHOR_KSBD,
      description: DESCRIPTION_KSBD,
      status: 1,
    };
  }

  private async fetchChapterList(mangaUrl: string): Promise<Chapter[]> {
    const chapters: Chapter[] = [];
    const seen = new Set<string>();
    const visited = new Set<string>();
    let currentUrl = mangaUrl;
    let pageCount = 0;

    while (currentUrl && pageCount < MAX_CHAPTER_ARCHIVE_PAGES) {
      if (visited.has(currentUrl)) break;
      visited.add(currentUrl);
      pageCount += 1;

      const doc = await this.get(currentUrl);
      const $ = this.$(doc.data);

      $('.comic-thumbnail-in-archive a[href*="/comic/"]').each((_, el) => {
        const $el = $(el);
        const href = $el.attr('href') || '';
        if (!href || seen.has(href)) return;
        seen.add(href);

        const title = ($el.attr('title') || $el.text() || '').trim();
        const numberMatch = href.match(/(\d+(?:-\d+)?)\/?$/);
        const chapterNumber = numberMatch ? parseFloat(numberMatch[1].split('-')[0]) : chapters.length + 1;

        chapters.push({
          name: title || `Page ${chapters.length + 1}`,
          url: href,
          chapterNumber,
        });
      });

      currentUrl = $('#paginav .paginav-next a[href]').first().attr('href') || '';
    }

    return chapters;
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const manga = await this.fetchManga();
    return {
      mangas: manga ? [manga] : [],
      hasNextPage: false,
    };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getPopular(page);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const manga = await this.fetchManga();
    if (!manga) return { mangas: [], hasNextPage: false };

    const normalized = query.toLowerCase().trim();
    const matches = normalized.length === 0 || manga.title.toLowerCase().includes(normalized);

    return {
      mangas: matches ? [manga] : [],
      hasNextPage: false,
    };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    return {
      title: TITLE_KSBD,
      url: mangaUrl,
      lang: this.lang,
      author: AUTHOR_KSBD,
      description: DESCRIPTION_KSBD,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    return this.fetchChapterList(mangaUrl);
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const doc = await this.get(chapterUrl);
    const $ = this.$(doc.data);

    return $('#comic img')
      .map((index, el) => {
        const src = $(el).attr('src') || '';
        if (!src) return null;
        return { index: index + 1, imageUrl: src };
      })
      .get()
      .filter((page): page is Page => page !== null);
  }
}
