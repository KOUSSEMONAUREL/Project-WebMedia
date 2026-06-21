import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface MpcResponse {
  status: string;
  titles?: MpcTitle[];
}

interface MpcTitle {
  title: string;
  thumbnail: string;
  is_one_shot: boolean;
  author: { name: string };
  latest_episode: { title_connect_id: string };
}

interface MpcReaderDataPages {
  pc: MpcReaderPage[];
}

interface MpcReaderPage {
  page_no: number;
  image_url: string;
}

interface MpcReaderDataTitle {
  title: string;
  thumbnail: string;
  is_oneshot: boolean;
  contents_id: string;
}

interface ChaptersPage {
  chapters: Chapter[];
  hasNextPage: boolean;
}

const PREFIX_TITLE_ID_SEARCH = 'title:';
const PREFIX_EPISODE_ID_SEARCH = 'episode:';
const PREFIX_AUTHOR_ID_SEARCH = 'author:';

export class MangaPlusCreatorsScraper extends BaseScraper {
  readonly name = 'MANGA Plus Creators by SHUEISHA';
  readonly baseUrl = 'https://mangaplus-creators.jp';
  readonly lang = 'all';

  async getPopular(_page: number): Promise<SearchResult> {
    const response = await this.get(`${this.baseUrl}/titles/popular/?p=m&l=en`);
    return this.parseMangasPageFromElement(response.data, 'div.item-recent');
  }

  private parseMangasPageFromElement(html: string, selector: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $(selector).each((_, el) => {
      const $el = $(el);
      const img = $el.find('.image-area img').first();
      const thumbSrc = img.attr('src') || '';
      const titleContentId = thumbSrc.split('/')[2];
      const title = $el.find('.title-area .title').text();
      mangas.push({
        url: `/titles/${titleContentId}`,
        title,
        thumbnailUrl: thumbSrc,
        lang: this.lang,
      });
    });
    return { mangas, hasNextPage: false };
  }

  async getSearch(query: string, _page?: number): Promise<SearchResult> {
    if (query.startsWith('https://')) {
      const url = new URL(query);
      if (!['mangaplus-creators.jp', 'medibang.com'].includes(url.host)) {
        throw new Error('Unsupported url');
      }
      const pathIndex = url.host === 'medibang.com' ? 1 : 0;
      const idIndex = pathIndex + 1;
      if (url.pathname.split('/').filter(Boolean).length <= idIndex) {
        throw new Error('Unsupported url');
      }
      const pathPart = url.pathname.split('/').filter(Boolean)[pathIndex];
      const idPart = url.pathname.split('/').filter(Boolean)[idIndex];
      let newQuery: string;
      if (pathPart === 'episodes') newQuery = `${PREFIX_EPISODE_ID_SEARCH}${idPart}`;
      else if (pathPart === 'authors') newQuery = `${PREFIX_AUTHOR_ID_SEARCH}${idPart}`;
      else if (pathPart === 'titles') newQuery = `${PREFIX_TITLE_ID_SEARCH}${idPart}`;
      else throw new Error('Unsupported url');
      return this.getSearch(newQuery);
    }

    if (query.startsWith(PREFIX_TITLE_ID_SEARCH)) {
      const titleContentId = query.replace(PREFIX_TITLE_ID_SEARCH, '');
      const response = await this.get(`${this.baseUrl}/titles/${titleContentId}`);
      const $ = this.$(response.data);
      const bookBox = $('.book-box').first();
      const title = bookBox.find('div.title').text();
      const thumbnailUrl = bookBox.find('div.cover img').first().attr('data-src') || '';
      return { mangas: [{ url: `/titles/${titleContentId}`, title, thumbnailUrl, lang: this.lang }], hasNextPage: false };
    }

    if (query.startsWith(PREFIX_EPISODE_ID_SEARCH)) {
      const episodeId = query.replace(PREFIX_EPISODE_ID_SEARCH, '');
      const response = await this.get(`${this.baseUrl}/episodes/${episodeId}`);
      const $ = this.$(response.data);
      const readerEl = $('div[react=viewer]').first();
      const dataTitle: MpcReaderDataTitle = JSON.parse(readerEl.attr('data-title') || '{}');
      return { mangas: [{ url: `/titles/${dataTitle.contents_id}`, title: dataTitle.title, thumbnailUrl: dataTitle.thumbnail, lang: this.lang }], hasNextPage: false };
    }

    if (query.startsWith(PREFIX_AUTHOR_ID_SEARCH)) {
      const authorId = query.replace(PREFIX_AUTHOR_ID_SEARCH, '');
      const response = await this.get(`${this.baseUrl}/authors/${authorId}`);
      const $ = this.$(response.data);
      const mangas: Manga[] = [];
      $('#works .manga-list li .md\\:block').each((_, el) => {
        const $el = $(el);
        const img = $el.find('.image-area img').first();
        const thumbSrc = img.attr('src') || '';
        const titleContentId = thumbSrc.split('/')[2];
        const title = $el.find('p.text-white').text();
        mangas.push({ url: `/titles/${titleContentId}`, title, thumbnailUrl: thumbSrc, lang: this.lang });
      });
      return { mangas, hasNextPage: false };
    }

    if (query) {
      const searchUrl = new URL(`${this.baseUrl}/keywords`);
      searchUrl.searchParams.set('q', query);
      searchUrl.searchParams.set('s', 'date');
      searchUrl.searchParams.set('lang', 'en');
      const response = await this.get(searchUrl.toString());
      return this.parseMangasPageFromElement(response.data, 'div.item-search');
    }

    return { mangas: [], hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const response = await this.get(mangaUrl);
    const $ = this.$(response.data);
    const bookBox = $('.book-box').first();
    const statusText = bookBox.find('div.book-submit-type').text();
    const status = statusText === 'Series' ? 1 : statusText === 'One-shot' ? 1 : 2;
    return {
      title: bookBox.find('div.title').text(),
      author: bookBox.find('div.mod-btn-profile div.name').text() || undefined,
      description: bookBox.find('div.summary p').map((_, el) => $(el).text()).get().join('\n\n') || undefined,
      status,
      genre: bookBox.find('div.genre-area div.tag-genre').map((_, el) => $(el).text()).get().join(', ') || undefined,
      thumbnailUrl: bookBox.find('div.cover img').first().attr('data-src') || '',
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const titleContentId = mangaUrl.split('/').filter(Boolean).pop() || '';
    const result: Chapter[] = [];
    let page = 1;
    let hasNextPage = true;

    while (hasNextPage) {
      const response = await this.get(`${this.baseUrl}/titles/${titleContentId}/?page=${page}`);
      const $ = this.$(response.data);
      $('.mod-item-series').each((_, el) => {
        const $el = $(el);
        const episode = $el.attr('href')?.split('/').pop() || '';
        const dateText = $el.find('.first-update').text();
        const chapterNumberText = $el.find('.number').text();
        const chapterNumber = chapterNumberText === 'One-shot' ? 0 : parseFloat(chapterNumberText.replace('#', '')) || -1;
        result.push({
          url: `/episodes/${episode}`,
          name: chapterNumberText,
          chapterNumber,
          dateUpload: dateText ? new Date(dateText).getTime() : undefined,
        });
      });
      hasNextPage = $('.mod-pagination .next').length > 0;
      page++;
    }

    return result.reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const response = await this.get(chapterUrl);
    const $ = this.$(response.data);
    const readerEl = $('div[react=viewer]').first();
    const dataPages: MpcReaderDataPages = JSON.parse(readerEl.attr('data-pages') || '{}');
    return (dataPages.pc || []).map(p => ({
      index: p.page_no,
      imageUrl: p.image_url,
    }));
  }
}
