import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

interface ComikeyComic {
  link: string;
  name: string;
  author: { name: string }[];
  artist: { name: string }[];
  tags: { name: string }[];
  description: string;
  excerpt: string;
  format: number;
  full_cover: string;
  update_status: number;
  update_text: string;
}

interface ComikeyEpisode {
  id: string;
  number: number;
  title: string;
  subtitle: string | null;
  releasedAt: string;
  finalPrice: number;
  owned: boolean;
}

interface ComikeyEpisodeListResponse {
  episodes: ComikeyEpisode[];
}

interface ComikeyEpisodeManifest {
  metadata: { readingProgression: string };
  readingOrder: ComikeyPage[];
}

interface ComikeyPage {
  href: string;
  type: string;
  height: number;
  width: number;
  alternate: ComikeyAlternatePage[];
}

interface ComikeyAlternatePage {
  href: string;
  type: string;
  height: number;
  width: number;
}

const PREFIX_SLUG_SEARCH = 'slug:';

const RELAY_HOST_REGEX = /relay-\w+\.epub\.rocks/;

export class ComikeyScraper extends BaseScraper {
  readonly name = 'Comikey';
  readonly baseUrl = 'https://comikey.com';
  readonly lang = 'all';

  async getPopular(page: number): Promise<SearchResult> {
    const response = await this.get(`${this.baseUrl}/comics/?order=-views&page=${page}`);
    const $ = this.$(response.data);
    const mangas: Manga[] = [];
    $('div.series-listing[data-view=list] > ul > li').each((_, el) => {
      const $el = $(el);
      const linkEl = $el.find('div.series-data span.title a');
      const href = linkEl.attr('abs:href') || '';
      const title = linkEl.text();
      const desc = $el.find('div.excerpt p').text() + '\n\n' + $el.find('div.desc p').text();
      const genre = $el.find('ul.category-listing li a').map((_, a) => $(a).text()).get().join(', ');
      const thumb = $el.find('div.image picture img').attr('abs:src') || '';
      mangas.push({ url: href.replace(this.baseUrl, ''), title, description: desc, genre, thumbnailUrl: thumb, lang: this.lang });
    });
    const hasNextPage = $('ul.pagination li.next-page:not(.disabled)').length > 0;
    return { mangas, hasNextPage };
  }

  async getSearch(query: string, page?: number): Promise<SearchResult> {
    if (query.startsWith('https://')) {
      const url = new URL(query);
      if (url.host !== new URL(this.baseUrl).host) {
        throw new Error('Unsupported url');
      }
      const slug = `${url.pathname.split('/')[1]}/${url.pathname.split('/')[2]}`;
      const mangaUrl = `/comics/${slug}/`;
      const manga = await this.getMangaDetails(mangaUrl) as Manga;
      return { mangas: [manga], hasNextPage: false };
    }
    if (query.startsWith(PREFIX_SLUG_SEARCH)) {
      const slug = query.replace(PREFIX_SLUG_SEARCH, '');
      const mangaUrl = `/comics/${slug}/`;
      const manga = await this.getMangaDetails(mangaUrl) as Manga;
      return { mangas: [manga], hasNextPage: false };
    }

    const url = new URL(`${this.baseUrl}/comics/`);
    if (page && page > 1) url.searchParams.set('page', page.toString());
    if (query.length >= 2) url.searchParams.set('q', query);

    const response = await this.get(url.toString());
    const $ = this.$(response.data);
    const mangas: Manga[] = [];
    $('div.series-listing[data-view=list] > ul > li').each((_, el) => {
      const $el = $(el);
      const linkEl = $el.find('div.series-data span.title a');
      mangas.push({
        url: linkEl.attr('abs:href')?.replace(this.baseUrl, '') || '',
        title: linkEl.text(),
        description: $el.find('div.excerpt p').text() + '\n\n' + $el.find('div.desc p').text(),
        genre: $el.find('ul.category-listing li a').map((_, a) => $(a).text()).get().join(', '),
        thumbnailUrl: $el.find('div.image picture img').attr('abs:src') || '',
        lang: this.lang,
      });
    });
    return { mangas, hasNextPage: $('ul.pagination li.next-page:not(.disabled)').length > 0 };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const response = await this.get(`${this.baseUrl}${mangaUrl}`);
    const $ = this.$(response.data);
    const rawData = $('script#comic').data();
    const data: ComikeyComic = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    return {
      url: data.link,
      title: data.name,
      author: data.author.map((a: { name: string }) => a.name).join(', '),
      artist: data.artist.map((a: { name: string }) => a.name).join(', '),
      description: `"${data.excerpt}"\n\n${data.description}`,
      thumbnailUrl: `${this.baseUrl}${data.full_cover}`,
      genre: [...data.tags.map((t: { name: string }) => t.name), ['', 'Comic', 'Manga', 'Webtoon'][data.format] || ''].filter(Boolean).join(', '),
      status: data.update_status === 1 ? 1 : [3].includes(data.update_status) ? 3 : 2,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const response = await this.get(`${this.baseUrl}${mangaUrl}`);
    const $ = this.$(response.data);
    const mangaSlug = mangaUrl.split('/')[1];
    const rawData = $('script#comic').data();
    const mangaData: ComikeyComic = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    const defaultChapterPrefix = mangaData.format === 2 ? 'episode' : 'chapter';
    const mangaId = mangaUrl.split('/')[2];

    const gundamTokenEl = $('script:containsData(GUNDAM.token)').data();
    const gundamToken = gundamTokenEl
      ? String(gundamTokenEl).split('= "')[1]?.split('";')[0]
      : null;

    const chapterUrl = new URL('https://gundam.comikey.net');
    chapterUrl.pathname = gundamToken ? `/comic/${mangaId}/episodes` : `/comic.public/${mangaId}/episodes`;
    chapterUrl.searchParams.set('language', this.lang.toLowerCase());
    if (gundamToken) chapterUrl.searchParams.set('token', gundamToken);

    const chResponse = await this.get(chapterUrl.toString());
    const data: ComikeyEpisodeListResponse = typeof chResponse === 'string' ? JSON.parse(chResponse) : chResponse.data;

    const currentTime = Date.now();

    return data.episodes
      .filter((ep: ComikeyEpisode) => ep.finalPrice === 0 || ep.owned)
      .map((ep: ComikeyEpisode) => {
        const e4pid = ep.id.split('-', 2)[1];
        const slug = `${e4pid}/${defaultChapterPrefix}-${ep.number.toString().replace('.0', '').replace('.', '-')}`;
        return {
          url: `/read/${mangaSlug}/${slug}/`,
          name: ep.subtitle ? `${ep.title}: ${ep.subtitle}` : ep.title,
          chapterNumber: ep.number,
          dateUpload: new Date(ep.releasedAt).getTime(),
        };
      })
      .filter((ch: Chapter) => (ch.dateUpload || 0) <= currentTime)
      .reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const fullUrl = `${this.baseUrl}${chapterUrl}`;
    const response = await this.get(fullUrl);
    const $ = this.$(response.data);

    const scriptData = $('script:containsData(GUNDAM.token)').data();
    const gundamToken = scriptData
      ? String(scriptData).split('= "')[1]?.split('";')[0]
      : null;

    const manifestResp = await this.get(fullUrl);
    const $$ = this.$(manifestResp.data);
    const nextData = $$('script#__NEXT_DATA__').data();
    let manifest: ComikeyEpisodeManifest | null = null;

    if (nextData) {
      manifest = typeof nextData === 'string' ? JSON.parse(nextData) : nextData;
    }

    const relayMatch = manifestResp.data.match(RELAY_HOST_REGEX);
    if (relayMatch) {
      const mResp = await this.get(`${chapterUrl}/manifest`);
      manifest = typeof mResp === 'string' ? JSON.parse(mResp) : mResp.data;
    }

    if (!manifest) {
      const altResp = await this.get(gundamToken ? `https://gundam.comikey.net/comic/${chapterUrl.split('/')[2]}/episodes` : chapterUrl);
      manifest = typeof altResp === 'string' ? JSON.parse(altResp) : altResp.data;
    }

    if (!manifest) return [];

    const webtoon = manifest.metadata?.readingProgression === 'ttb';

    return (manifest.readingOrder || []).map((item: ComikeyPage, i: number) => {
      let imageUrl = '';
      if (item.alternate?.length && item.height === 2048 && item.type === 'image/jpeg') {
        const alt = item.alternate.find((a: ComikeyAlternatePage) => {
          const dim = webtoon ? a.width : a.height;
          return dim <= 1536 && a.type === 'image/webp';
        });
        imageUrl = alt?.href || item.href;
      } else {
        imageUrl = item.href;
      }
      return { index: i, imageUrl };
    });
  }
}
