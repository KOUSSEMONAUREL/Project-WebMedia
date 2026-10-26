import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const AUTHOR_KSBD = 'Abbadon';
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

const PAGES_ORDER = '?order=ASC';

export class KillSixBillionDemons extends BaseScraper {
  readonly name = 'KillSixBillionDemons';
  readonly baseUrl = 'https://killsixbilliondemons.com';
  readonly lang = 'en';

  private async fetchBooksAsMangas(): Promise<Manga[]> {
    const doc = await this.get(this.baseUrl);
    const $ = this.$(doc.data);
    const mangas: Manga[] = [];

    $('#chapter option.isBookOption').each((_, el) => {
      const $el = $(el);
      const value = $el.attr('value') || '';
      const text = $el.text().trim();
      if (!value || text === 'Select chapter') return;

      const title = text.split(' (')[0];
      const overviewUrl = value;

      mangas.push({
        title,
        url: overviewUrl,
        thumbnailUrl: '',
        lang: this.lang,
        author: AUTHOR_KSBD,
        description: DESCRIPTION_KSBD,
        status: 1,
      });
    });

    return mangas;
  }

  private async fetchThumbnailUrl(bookOverviewUrl: string): Promise<string> {
    const overviewDoc = await this.get(bookOverviewUrl + PAGES_ORDER);
    const $ = this.$(overviewDoc.data);
    const thumb = $('.comic-thumbnail-in-archive a img').first();
    return thumb.length ? thumb.attr('src') || '' : '';
  }

  private async fetchChapterList(mangaUrl: string): Promise<Chapter[]> {
    const doc = await this.get(mangaUrl);
    const $ = this.$(doc.data);
    const options = $('#chapter option');

    const chapters: Chapter[] = [];

    options.each((_, el) => {
      const $el = $(el);
      const text = $el.text().trim();
      const value = $el.attr('value') || '';

      if (text === 'Select chapter' || !value) return;

      const chapterTitle = 'Chapter ' + text.split(' (')[0].trim();
      const chapterNumber = parseFloat(text.replace(/[^\d.]/g, '')) || 0;

      chapters.push({
        name: chapterTitle,
        url: value,
        chapterNumber,
      });
    });

    return chapters;
  }

  private async fetchActiveChapterPages(
    chapterUrl: string,
    chapterTitle: string,
    startChapterNumber: number,
  ): Promise<Chapter[]> {
    const chapters: Chapter[] = [];
    let currentUrl = this.baseUrl + chapterUrl + PAGES_ORDER;
    let pageNum = startChapterNumber;

    while (currentUrl) {
      const doc = await this.get(currentUrl);
      const $ = this.$(doc.data);

      const links = $('.comic-thumbnail-in-archive a');
      links.each((_, el) => {
        const $el = $(el);
        const href = $el.attr('href') || '';
        const title = $el.attr('title') || '';
        if (href) {
          pageNum = pageNum + 1;
          chapters.push({
            name: chapterTitle + ' - ' + (title.trim() || `Page ${pageNum}`),
            url: href,
            chapterNumber: pageNum,
          });
        }
      });

      const nextUrl = $('.paginav-next a').attr('href') || '';
      if (!nextUrl || nextUrl === currentUrl) break;
      currentUrl = nextUrl;
    }

    return chapters;
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const mangas = await this.fetchBooksAsMangas();
    return {
      mangas,
      hasNextPage: mangas.length > 0,
    };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    throw new Error(`${this.name}: getLatest() not implemented`);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    throw new Error(`${this.name}: getSearch() not available`);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const doc = await this.get(mangaUrl);
    const $ = this.$(doc.data);
    const title = $('.post-title').first().text() || '';
    const thumbnail = $('.comic-thumbnail-in-archive a img').first().attr('src') || '';

    return {
      title,
      url: mangaUrl,
      thumbnailUrl: thumbnail,
      lang: this.lang,
      author: AUTHOR_KSBD,
      description: DESCRIPTION_KSBD,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    return await this.fetchChapterList(mangaUrl);
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const doc = await this.get(chapterUrl);
    const $ = this.$(doc.data);
    const imageEls = $('#comic img');

    return imageEls.map((_, el) => {
      const $el = $(el);
      const src = $el.attr('src') || '';
      return {
        index: 0,
        imageUrl: src,
      };
    }).get();
  }
}