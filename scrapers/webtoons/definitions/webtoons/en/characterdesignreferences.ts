import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface Section {
  title: string;
  firstCollection: string;
  collectionPrefix: string | null;
  titleIsArtist: boolean;
}

interface SearchItem {
  title: string;
  itemUrl: string;
  imageUrl?: string | null;
}

interface SearchResponse {
  totalCount: number;
  items: SearchItem[];
}

interface Item {
  title: string;
  assetUrl?: string | null;
  publishOn: number;
  body: string;
  tags: string[];
  categories: string[];
}

interface ItemResponse {
  item: Item;
}

const SECTIONS: Section[] = [
  { title: 'Art of Animation', firstCollection: 'art-of-animation-1', collectionPrefix: 'art-of-animation-', titleIsArtist: false },
  { title: 'Artist of the Week', firstCollection: 'artists-of-the-week', collectionPrefix: 'artist-of-the-week-', titleIsArtist: true },
  { title: 'Artist Interviews', firstCollection: 'blog-interviews', collectionPrefix: 'blog-interviews-', titleIsArtist: true },
  { title: 'Challenge Winners', firstCollection: 'winners1', collectionPrefix: 'winners', titleIsArtist: false },
  { title: 'Challengers Spotlight', firstCollection: 'challengers-spotlights', collectionPrefix: null, titleIsArtist: false },
];

const SEARCH_SIZE = 200;
const GALLERY = '.sqs-block-gallery:not(:has(.sqs-gallery-block-slideshow))';
const SINGLE_IMAGE = "[data-definition-name='website.components.imageLayout'] img[data-image]";

function sectionOf(collection: string): Section | null {
  return SECTIONS.find(section => {
    if (section.firstCollection === collection) return true;
    if (!section.collectionPrefix || !collection.startsWith(section.collectionPrefix)) return false;
    return /^\d+$/.test(collection.slice(section.collectionPrefix.length));
  }) ?? null;
}

function collectionName(section: Section, number: number): string | null {
  if (number === 1) return section.firstCollection;
  return section.collectionPrefix ? `${section.collectionPrefix}${number}` : null;
}

export class CharacterDesignReferencesScraper extends BaseScraper {
  override readonly name = 'Character Design References';
  override readonly baseUrl = 'https://characterdesignreferences.com';
  override readonly lang = 'en';

  private collectionCursor = 1;
  private searchCursor = 0;

  async getPopular(page = 1): Promise<SearchResult> {
    return this.getSectionListing(SECTIONS[0], page);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const search = query.trim();
    if (!search) return this.getSectionListing(SECTIONS[0], page);
    if (page === 1) this.searchCursor = 0;
    while (true) {
      const url = new URL(`${this.baseUrl}/api/search/GeneralSearch`);
      url.searchParams.set('q', search);
      url.searchParams.set('p', String(this.searchCursor));
      url.searchParams.set('size', String(SEARCH_SIZE));
      const response = await this.get(url.toString(), { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
      const data = response.data as SearchResponse;
      this.searchCursor++;
      const mangas = data.items
        .filter(item => this.isPostPath(this.absUrl(item.itemUrl)))
        .map(item => this.toManga(item));
      const hasNextPage = this.searchCursor * SEARCH_SIZE < data.totalCount;
      if (mangas.length > 0 || !hasNextPage) return { mangas, hasNextPage };
    }
  }

  private async getSectionListing(section: Section, page: number): Promise<SearchResult> {
    if (page === 1) this.collectionCursor = 1;
    while (true) {
      const collection = collectionName(section, this.collectionCursor++);
      if (!collection) return { mangas: [], hasNextPage: false };
      let html: string;
      try {
        const response = await this.get(`${this.baseUrl}/${collection}`);
        html = response.data as string;
      } catch (error) {
        const status = (error as { response?: { status?: number } }).response?.status;
        if (status === 404) return { mangas: [], hasNextPage: false };
        if (status === 401) continue;
        throw error;
      }
      const mangas: Manga[] = [];
      while (true) {
        const $ = this.$(html);
        $('article.hentry').each((_, el) => {
          const article = $(el);
          const link = article.find('h1.entry-title a').first();
          const imageUrl = article.find('.excerpt-thumb img').first().attr('data-image') || '';
          mangas.push({
            title: link.text(),
            url: this.absUrl(link.attr('href') || ''),
            thumbnailUrl: imageUrl ? this.coverUrl(imageUrl) : '',
            lang: this.lang,
          });
        });
        const next = $('a#nextLink').first().attr('href');
        if (!next) break;
        const response = await this.get(next);
        html = response.data as string;
      }
      if (mangas.length > 0) return { mangas, hasNextPage: section.collectionPrefix !== null };
    }
  }

  private toManga(item: SearchItem): Manga {
    const imageUrl = item.imageUrl?.replace(/\/$/, '');
    return {
      title: this.unescapeTitle(item.title),
      url: this.absUrl(item.itemUrl),
      thumbnailUrl: imageUrl ? this.coverUrl(imageUrl) : '',
      lang: this.lang,
    };
  }

  private isPostPath(url: string): boolean {
    const parsed = new URL(url);
    if (parsed.hostname.replace(/^www\./, '') !== new URL(this.baseUrl).hostname) return false;
    const segments = parsed.pathname.split('/').filter(Boolean);
    return segments.length === 2 && sectionOf(segments[0]) !== null;
  }

  private coverUrl(url: string): string {
    const parsed = new URL(this.absUrl(url));
    parsed.searchParams.set('format', '750w');
    return parsed.toString();
  }

  private unescapeTitle(value: string): string {
    return this.$(`<span>${value}</span>`).text().trim();
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const absoluteUrl = this.absUrl(mangaUrl);
    const item = await this.getItem(absoluteUrl);
    const section = sectionOf(new URL(absoluteUrl).pathname.split('/').filter(Boolean)[0] || '');
    const $ = this.$(item.body);
    const intro: string[] = [];
    let started = false;
    for (const block of $('.sqs-block-html, .sqs-block-gallery').toArray()) {
      const el = $(block);
      if (!started) {
        if (!el.hasClass('sqs-block-html')) continue;
        started = true;
      }
      if (!el.hasClass('sqs-block-html')) break;
      const text = el.text().trim();
      if (text) intro.push(text);
    }
    let author: string | undefined;
    if (section?.titleIsArtist) {
      author = this.unescapeTitle(item.title);
    } else if (section?.title === 'Challenge Winners') {
      const captions = $(GALLERY).first().find('.image-slide-title').toArray()
        .map(el => $(el).text().replace(/\u200E/g, '').trim());
      const distinct = [...new Set(captions)];
      author = distinct.length > 0 ? distinct.join(', ') : undefined;
    }
    const genre = section
      ? [...new Set([section.title, ...item.categories, ...item.tags])].join(', ')
      : [...new Set([...item.categories, ...item.tags])].join(', ');
    return {
      url: absoluteUrl,
      title: this.unescapeTitle(item.title),
      author,
      genre,
      description: [`${this.imageUrls($).length} images`, ...intro].join('\n\n'),
      thumbnailUrl: item.assetUrl ? this.coverUrl(item.assetUrl) : undefined,
      status: 0,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const absoluteUrl = this.absUrl(mangaUrl);
    const item = await this.getItem(absoluteUrl);
    return [{ name: 'Gallery', url: absoluteUrl, dateUpload: item.publishOn }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const item = await this.getItem(chapterUrl);
    const $ = this.$(item.body);
    return this.imageUrls($).map((imageUrl, index) => ({ index, imageUrl }));
  }

  private imageUrls($: ReturnType<typeof this.$>): string[] {
    const urls: string[] = [];
    $(`${GALLERY} img[data-image], ${SINGLE_IMAGE}`).each((_, el) => {
      const image = $(el);
      const inGallery = image.closest('.sqs-block-gallery').length > 0;
      const linked = image.closest('.sqs-block').find('a[href]').length > 0;
      if (inGallery || !linked) {
        const dataImage = image.attr('data-image');
        if (dataImage) urls.push(this.absUrl(dataImage));
      }
    });
    return urls;
  }

  private async getItem(url: string): Promise<Item> {
    const jsonUrl = new URL(this.absUrl(url));
    jsonUrl.searchParams.set('format', 'json');
    const response = await this.get(jsonUrl.toString(), { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    return (response.data as ItemResponse).item;
  }
}
