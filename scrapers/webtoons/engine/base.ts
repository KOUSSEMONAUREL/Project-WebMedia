// ============================================================
// BaseScraper — équivalent TS de HttpSource (Tachiyomi/Keiyoushi)
// Cycle de vie : get(url) → html → parse → Model (Manga/Chapter/Page)
// ============================================================

import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import * as cheerio from 'cheerio';
import type { Manga, Chapter, Page, SearchResult } from './types';

export abstract class BaseScraper {
  abstract readonly name: string;
  abstract readonly baseUrl: string;
  abstract readonly lang: string;

  protected readonly client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      timeout: 30_000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'max-age=0',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
      },
    });
  }

  // ——— Méthodes obligatoires ———

  abstract getSearch(query: string, page?: number): Promise<SearchResult>;
  abstract getChapterList(mangaUrl: string): Promise<Chapter[]>;
  abstract getPageList(chapterUrl: string): Promise<Page[]>;

  // ——— Méthodes optionnelles ———

  async getPopular(_page = 1): Promise<SearchResult> {
    throw new Error(`${this.name}: getPopular() not implemented`);
  }

  async getLatest(_page = 1): Promise<SearchResult> {
    throw new Error(`${this.name}: getLatest() not implemented`);
  }

  async getMangaDetails(_mangaUrl: string): Promise<Partial<Manga>> {
    return {};
  }

  // ——— Helpers protégés ———

  /** Équivalent de response.asJsoup() en Kotlin */
  protected $(html: string): cheerio.CheerioAPI {
    return cheerio.load(html);
  }

  /**
   * GET sécurisé — construit toujours une URL absolue correcte.
   * Gère : path relatif ("/catalogue"), URL absolue, URL avec params.
   * Keiyoushi équivalent : client.newCall(GET(url, headers)).execute()
   */
  protected async get(pathOrUrl: string, config?: AxiosRequestConfig) {
    const url = this.absUrl(pathOrUrl);
    // Injecter Referer = baseUrl (requis par beaucoup de sites FR)
    const headers = {
      'Accept-Language': `${this.lang}-${this.lang.toUpperCase()},${this.lang};q=0.9,en-US;q=0.8`,
      Referer: this.baseUrl + '/',
      ...config?.headers,
    };
    return this.client.get(url, { ...config, headers });
  }

  protected async post(pathOrUrl: string, data: unknown, config?: AxiosRequestConfig) {
    const url = this.absUrl(pathOrUrl);
    return this.client.post(url, data, config);
  }

  /**
   * Résout n'importe quel chemin vers une URL absolue.
   * Équivalent de element.absUrl("href") en Jsoup/Keiyoushi.
   */
  protected absUrl(path: string): string {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    if (path.startsWith('//')) return `https:${path}`;
    if (path.startsWith('/')) return `${this.baseUrl}${path}`;
    return `${this.baseUrl}/${path}`;
  }
}
