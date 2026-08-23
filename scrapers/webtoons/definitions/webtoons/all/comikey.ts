import { BaseScraper } from '../../../engine/base';
import type { CheerioAPI } from 'cheerio';
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
  number?: number;
  title: string;
  subtitle: string | null;
  releasedAt: string;
  finalPrice?: number;
  owned?: boolean;
}

interface ComikeyEpisodeListResponse {
  episodes: ComikeyEpisode[];
}

interface ComikeyInitData {
  manifest?: string;
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

export class ComikeyScraper extends BaseScraper {
  readonly name = 'Comikey';
  readonly baseUrl = 'https://comikey.com';
  readonly lang = 'all';

  private get defaultLanguage(): string {
    const url: string = this.baseUrl;
    return url === 'https://br.comikey.com' ? 'pt-br' : 'en';
  }

  private parseComicData($: CheerioAPI): ComikeyComic {
    const raw = $('script#comic').first().text().trim();
    if (!raw) throw new Error('Comikey: comic data script not found');
    return JSON.parse(raw) as ComikeyComic;
  }

  async getPopular(page: number): Promise<SearchResult> {
    const response = await this.get(`${this.baseUrl}/comics/?order=-views&page=${page}`);
    const $ = this.$(response.data);
    const mangas: Manga[] = [];
    $('div.series-listing[data-view=list] > ul > li').each((_, el) => {
      const manga = this.mangaFromElement($(el));
      if (manga) mangas.push(manga);
    });
    const hasNextPage = $('ul.pagination li.next-page:not(.disabled)').length > 0;
    return { mangas, hasNextPage };
  }

  private mangaFromElement($el: ReturnType<CheerioAPI>): Manga {
    const linkEl = $el.find('div.series-data span.title a').first();
    const href = linkEl.attr('href') || '';
    const desc = $el.find('div.excerpt p').text() + '\n\n' + $el.find('div.desc p').text();
    const genre = $el.find('ul.category-listing li a').map((_, a) => $el.find(a).text()).get().filter(Boolean).join(', ');
    const thumb = $el.find('div.image picture img').attr('src') || '';
    return { url: href.replace(this.baseUrl, ''), title: linkEl.text().trim(), description: desc, genre, thumbnailUrl: thumb.replace(this.baseUrl, ''), lang: this.lang };
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
      mangas.push(this.mangaFromElement($(el)));
    });
    return { mangas, hasNextPage: $('ul.pagination li.next-page:not(.disabled)').length > 0 };
  }

  private parseStatus(updateStatus: number, updateText: string): MangaStatus {
    switch (updateStatus) {
      case 0:
        // HACK: Comikey Brasil
        if (updateText.toLowerCase().startsWith('toda')) return 1;
        if (/^(em pausa|hiato)/i.test(updateText)) return 3;
        return 3;
      case 1:
        return 0;
      case 3:
        return 3;
      default:
        return updateStatus >= 4 && updateStatus <= 14 ? 1 : 3;
    }
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const response = await this.get(`${this.baseUrl}${mangaUrl}`);
    const $ = this.$(response.data);
    const data = this.parseComicData($);
    return {
      url: data.link,
      title: data.name,
      author: data.author.map((a: { name: string }) => a.name).join(', '),
      artist: data.artist.map((a: { name: string }) => a.name).join(', '),
      description: `"${data.excerpt}"\n\n${data.description}`,
      thumbnailUrl: `${this.baseUrl}${data.full_cover}`,
      genre: [...data.tags.map((t: { name: string }) => t.name), ['Comic', 'Manga', 'Webtoon'][data.format] || ''].filter(Boolean).join(', '),
      status: this.parseStatus(data.update_status, data.update_text),
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const response = await this.get(`${this.baseUrl}${mangaUrl}`);
    const $ = this.$(response.data);
    const segments = mangaUrl.split('/').filter(Boolean);
    const mangaSlug = segments[1];
    const mangaData = this.parseComicData($);
    const defaultChapterPrefix = mangaData.format === 2 ? 'episode' : 'chapter';
    const mangaId = segments[2];

    const tokenScript = $('script:contains(GUNDAM.token)').first().text();
    const gundamToken = /GUNDAM\.token\s*=\s*"([^"]+)"/.exec(tokenScript)?.[1] ?? null;

    const chapterUrl = new URL('https://gundam.comikey.net');
    chapterUrl.pathname = gundamToken ? `/comic/${mangaId}/episodes` : `/comic.public/${mangaId}/episodes`;
    chapterUrl.searchParams.set('language', this.defaultLanguage);
    if (gundamToken) chapterUrl.searchParams.set('token', gundamToken);

    const chResponse = await this.get(chapterUrl.toString());
    const data: ComikeyEpisodeListResponse = typeof chResponse === 'string' ? JSON.parse(chResponse) : chResponse.data;

    const currentTime = Date.now();

    return data.episodes
      .filter((ep: ComikeyEpisode) => (ep.finalPrice ?? 0) === 0 || ep.owned === true)
      .map((ep: ComikeyEpisode) => {
        const e4pid = ep.id.split('-', 2)[1];
        const number = ep.number ?? 0;
        const slug = `${e4pid}/${defaultChapterPrefix}-${number.toString().replace('.0', '').replace('.', '-')}`;
        return {
          url: `/read/${mangaSlug}/${slug}/`,
          name: ep.subtitle ? `${ep.title}: ${ep.subtitle}` : ep.title,
          chapterNumber: number,
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

    const initRaw = $('script#lmao-init').html();
    if (!initRaw) {
      throw new Error('Comikey: reader init data not found');
    }
    const initData: ComikeyInitData = JSON.parse(initRaw.trim());
    const manifestUrl = initData.manifest;
    if (!manifestUrl) {
      throw new Error('Comikey: manifest URL not found in reader init data');
    }

    const manifestResp = await this.get(manifestUrl);
    const manifest: ComikeyEpisodeManifest | null =
      typeof manifestResp.data === 'string' ? this.tryParseManifest(manifestResp.data) : manifestResp.data;

    if (!manifest || !Array.isArray(manifest.readingOrder)) {
      throw new Error('Comikey: manifest is DRM-protected and cannot be decrypted over plain HTTP');
    }

    const webtoon = manifest.metadata?.readingProgression === 'ttb';
    const manifestBase = new URL(manifestUrl);

    return manifest.readingOrder.map((item: ComikeyPage, i: number) => {
      let path = item.href;
      if (item.alternate?.length) {
        const alt =
          item.height === 2048 && item.type === 'image/jpeg'
            ? item.alternate.find((a: ComikeyAlternatePage) => {
                const dimension = webtoon ? a.width : a.height;
                return dimension <= 1536 && a.type === 'image/webp';
              })
            : item.alternate.find((a: ComikeyAlternatePage) => a.type === 'image/webp');
        path = alt?.href || item.href;
      }
      return { index: i, imageUrl: new URL(path, manifestBase).toString() };
    });
  }

  private tryParseManifest(raw: string): ComikeyEpisodeManifest | null {
    try {
      return JSON.parse(raw) as ComikeyEpisodeManifest;
    } catch {
      return null;
    }
  }
}
