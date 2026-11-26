/**
 * Transcompilation of keiyoushi `en/dorotoons` (Doro Toons).
 *
 * The catalogue (`/browse`) and series pages are plain HTML, but the site sits
 * behind a proof-of-work "human check" served at `/__human`. Upstream solves it
 * in `DoroToons.passHumanCheck`; the same SHA-256 leading-zero-bits challenge is
 * transcribed here, so catalogue and series pages stay readable over plain HTTP.
 * The reader is not used by the pipeline, but `getPageList` still reads the
 * signed JSON page list when the chapter is unlocked.
 */
import { createHash } from 'node:crypto';
import https from 'node:https';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, MangaStatus, Page, SearchResult } from '../../../engine/types';

const BASE_URL = 'https://dorotoons.com';
const HUMAN_PATH = '/__human';
const IPV4_AGENT = new https.Agent({ family: 4 });

interface HumanForm {
  action: string;
  next: string;
  challenge: string;
  bits: number;
}

interface ReaderPageDto {
  full?: string | null;
  lite?: string | null;
  src?: string | null;
}

interface ReaderDto {
  pages?: ReaderPageDto[];
}

function parseStatus(status: string | undefined): MangaStatus {
  switch (status?.trim().toLowerCase()) {
    case 'ongoing':
      return 1;
    case 'completed':
      return 0;
    case 'hiatus':
      return 2;
    case 'dropped':
      return 2;
    default:
      return undefined;
  }
}

function parseRelativeDate(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const match = text.trim().match(/^(\d+)(mo|m|h|d|w|y) ago$/);
  if (!match) return undefined;

  const amount = Number(match[1]);
  const date = new Date();
  switch (match[2]) {
    case 'm':
      date.setMinutes(date.getMinutes() - amount);
      break;
    case 'h':
      date.setHours(date.getHours() - amount);
      break;
    case 'd':
      date.setDate(date.getDate() - amount);
      break;
    case 'w':
      date.setDate(date.getDate() - amount * 7);
      break;
    case 'mo':
      date.setMonth(date.getMonth() - amount);
      break;
    case 'y':
      date.setFullYear(date.getFullYear() - amount);
      break;
  }
  return date.getTime();
}

function leadingZeroBits(buffer: Buffer): number {
  let bits = 0;
  for (const byte of buffer) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

export class DorotoonsScraper extends BaseScraper {
  readonly name = 'Doro Toons';
  readonly baseUrl = BASE_URL;
  readonly lang = 'en';

  private readonly cookies = new Map<string, string>();

  private cookieHeader(): Record<string, string> {
    if (this.cookies.size === 0) return {};
    const value = [...this.cookies.entries()].map(([name, cookie]) => `${name}=${cookie}`).join('; ');
    return { Cookie: value };
  }

  private captureCookies(res: AxiosResponse): void {
    const raw = res.headers['set-cookie'];
    const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
    for (const value of values) {
      const pair = value.split(';', 1)[0];
      const separator = pair.indexOf('=');
      if (separator <= 0) continue;
      this.cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1));
    }
  }

  private parseHumanForm(html: string): HumanForm | null {
    if (!html.includes('hcForm')) return null;

    const $ = this.$(html);
    const form = $('#hcForm');
    if (form.length === 0) return null;

    const challenge = form.find('input[name="challenge"]').attr('value') ?? '';
    const next = form.find('input[name="next"]').attr('value') ?? '/';
    const action = form.attr('action') || HUMAN_PATH;
    const match = html.match(/solve\("[^"]+",\s*(\d+)/);
    const bits = match ? Number(match[1]) : Number.NaN;
    if (!challenge || !Number.isFinite(bits) || bits <= 0) return null;

    return { action, next, challenge, bits };
  }

  private solve(challenge: string, bits: number): number {
    const prefix = `${challenge}:`;
    const limit = 20_000_000;
    for (let nonce = 0; nonce < limit; nonce += 1) {
      const digest = createHash('sha256').update(prefix + nonce).digest();
      if (leadingZeroBits(digest) >= bits) return nonce;
    }
    throw new Error(`Doro Toons: could not solve human check (${bits} bits)`);
  }

  private async submitHuman(form: HumanForm, refererPath: string): Promise<void> {
    const started = Date.now();
    const nonce = this.solve(form.challenge, form.bits);
    const elapsed = Math.max(1, Date.now() - started);
    const body = new URLSearchParams({
      next: form.next,
      challenge: form.challenge,
      nonce: String(nonce),
      t: String(elapsed),
    });

    const res = await this.post(form.action, body.toString(), {
      httpsAgent: IPV4_AGENT,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: this.baseUrl,
        Referer: this.absUrl(refererPath),
        ...this.cookieHeader(),
      },
      maxRedirects: 0,
      validateStatus: status => status >= 200 && status < 400,
    });
    this.captureCookies(res);
  }

  private async request(path: string, config?: AxiosRequestConfig): Promise<AxiosResponse> {
    const run = () =>
      this.get(path, {
        ...config,
        httpsAgent: IPV4_AGENT,
        headers: { ...this.cookieHeader(), ...config?.headers },
      });

    let res = await run();
    this.captureCookies(res);

    const html = typeof res.data === 'string' ? res.data : '';
    const form = html ? this.parseHumanForm(html) : null;
    if (form) {
      await this.submitHuman(form, path);
      res = await run();
      this.captureCookies(res);
    }
    return res;
  }

  private async fetchHtml(path: string, config?: AxiosRequestConfig): Promise<string> {
    const res = await this.request(path, config);
    return typeof res.data === 'string' ? res.data : String(res.data);
  }

  private parseListing(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = $('main .card:has(> a.card-cover)')
      .toArray()
      .map(element => {
        const card = $(element);
        const cover = card.find('> a.card-cover').first();
        const href = cover.attr('href') ?? '';
        const slug = href.split('/').filter(Boolean).pop() ?? '';
        return {
          title: card.find('.card-body h3').first().text().trim(),
          url: slug ? `/series/${slug}` : '',
          thumbnailUrl: this.absUrl(cover.find('img').first().attr('src') ?? ''),
          lang: this.lang,
          genre: cover.find('.cov-kind').first().text().trim() || undefined,
          status: parseStatus(cover.find('.cov-status').first().text()),
        };
      })
      .filter(manga => manga.title && manga.url);

    return { mangas, hasNextPage: $('.pager .here + a').length > 0 };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const params = new URLSearchParams({ sort: 'popular' });
    if (page > 1) params.set('page', String(page));
    return this.parseListing(await this.fetchHtml(`/browse?${params.toString()}`));
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const suffix = page > 1 ? `?page=${page}` : '';
    return this.parseListing(await this.fetchHtml(`/browse${suffix}`));
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (page > 1) params.set('page', String(page));
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return this.parseListing(await this.fetchHtml(`/browse${suffix}`));
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const $ = this.$(await this.fetchHtml(mangaUrl));
    const main = $('.sp-main').first();
    const type = this.fact($, 'Type');
    const genres = main.find('.genres a.tag').map((_, element) => $(element).text().trim()).get().filter(Boolean);
    const altTitles = main.find('.aka-list > span').map((_, element) => $(element).text().trim()).get().filter(Boolean);
    const synopsis = main.find('#synopsis').text().trim();

    const descriptionParts: string[] = [];
    if (synopsis) descriptionParts.push(synopsis);
    if (altTitles.length > 0) descriptionParts.push(`Alternative Titles: ${altTitles.join(', ')}`);

    return {
      title: main.find('h1').first().text().trim(),
      url: mangaUrl,
      thumbnailUrl: this.absUrl($('.sp-cover img').first().attr('src') ?? ''),
      lang: this.lang,
      genre: [...new Set([type, ...genres].filter((value): value is string => Boolean(value)))].join(', ') || undefined,
      status: parseStatus(this.fact($, 'Status')),
      description: descriptionParts.join('\n\n') || undefined,
    };
  }

  private fact($: ReturnType<BaseScraper['$']>, name: string): string | undefined {
    const value = $('.sp-facts dt')
      .filter((_, element) => $(element).text().trim() === name)
      .first()
      .next('dd')
      .text()
      .trim();
    return value || undefined;
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const $ = this.$(await this.fetchHtml(mangaUrl));
    return $('#chapterList .ch-cell > a.ch')
      .toArray()
      .map(element => {
        const link = $(element);
        const href = link.attr('href') ?? '';
        const locked = link.hasClass('ch-locked');
        const label = link.find('.ch-main > b').first().text().trim();
        const title = link.find('.ch-title').first().text().trim();
        const number = Number(link.parent().attr('data-no'));
        return {
          name: `${locked ? '🔒 ' : ''}${label}${title ? ` - ${title}` : ''}`.trim(),
          url: this.absUrl(href),
          chapterNumber: Number.isFinite(number) ? number : undefined,
          dateUpload: parseRelativeDate(link.find('.when').first().text()),
        };
      })
      .filter(chapter => chapter.name && chapter.url);
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const url = new URL(this.absUrl(chapterUrl));
    url.searchParams.set('pages', '1');

    const res = await this.request(url.toString(), {
      headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
    });
    if (typeof res.data !== 'object' || res.data === null) return [];

    const data = res.data as ReaderDto;
    return (data.pages ?? [])
      .map((item, index) => ({
        index: index + 1,
        imageUrl: this.absUrl(item.full ?? item.lite ?? item.src ?? ''),
      }))
      .filter(page => page.imageUrl);
  }
}

export default DorotoonsScraper;
