import * as cheerio from 'cheerio';
import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

function parseStatus(statusText?: string | null): MangaStatus {
  switch (statusText?.toLowerCase().trim()) {
    case 'ongoing': return 1;
    case 'completed': return 0;
    default: return 3;
  }
}

function extractSlug(url: string): string {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('manga');
    if (idx !== -1 && parts[idx + 1]) {
      return parts[idx + 1];
    }
    return parts[parts.length - 1] ?? url;
  } catch {
    return url.replace(/^.*\/manga\//, '').replace(/[/?#].*$/, '');
  }
}

export class MangahomeScraper extends BaseScraper {
  override readonly name = 'MangaHome';
  override readonly baseUrl = 'https://www.mangahome.com';
  override readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    const url = `${this.baseUrl}/directory/${page}.htm`;
    return this.parseMangaList(url);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const url = `${this.baseUrl}/latest/${page}.html`;
    return this.parseMangaList(url);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const trimmed = query.trim();
    if (!trimmed) {
      return this.getPopular(page);
    }
    const url = `${this.baseUrl}/search?page=${page}&name_method=cw&name=${encodeURIComponent(trimmed)}&advopts=1`;
    return this.parseMangaList(url);
  }

  private async parseMangaList(url: string): Promise<SearchResult> {
    const res = await this.get(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        Referer: `${this.baseUrl}/`,
      },
    });
    const $ = cheerio.load(res.data);
    const mangas: Manga[] = [];

    $('ul.manga-list .post').each((_i, el) => {
      const link = $(el).find('p.title a').first();
      const href = link.attr('href');
      if (!href) return;
      const slug = href.replace(/^.*\/manga\//, '').replace(/\/$/, '');
      const rawTitle = link.text().trim();
      const title = rawTitle.endsWith('...') ? (link.attr('title') || rawTitle) : rawTitle;
      const thumb = $(el).find('img').first().attr('src') || '';
      const fullThumb = thumb.startsWith('//') ? `https:${thumb}` : thumb;

      mangas.push({
        title,
        url: `${this.baseUrl}/manga/${slug}`,
        thumbnailUrl: fullThumb,
        lang: this.lang,
      });
    });

    const hasNextPage = $('.page-nav a.next').length > 0;
    return {
      mangas,
      hasNextPage,
    };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = extractSlug(mangaUrl);
    const url = `${this.baseUrl}/manga/${slug}`;
    const res = await this.get(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        Referer: `${this.baseUrl}/`,
      },
    });
    const $ = cheerio.load(res.data);
    const title = $('h1').first().text().trim();
    const coverSrc = $('img.detail-cover').first().attr('src') || '';
    const fullCover = coverSrc.startsWith('//') ? `https:${coverSrc}` : coverSrc;

    const author = $('p:has(span:contains("Author")) a').map((_i, el) => $(el).text().trim()).get().join(', ') || undefined;
    const artist = $('p:has(span:contains("Artist")) a').map((_i, el) => $(el).text().trim()).get().join(', ') || undefined;
    const genre = $('.manga-detailmiddle p:has(span:contains("Genre")) a').map((_i, el) => $(el).text().trim()).get().join(', ') || undefined;

    const statusText = $('p:has(span:contains("Status"))').first().text().replace(/Status\s*:?/i, '').trim();
    const status = parseStatus(statusText);

    const description = $('p.hide.mobile-none').first().text().trim() || undefined;

    return {
      title,
      url,
      thumbnailUrl: fullCover,
      lang: this.lang,
      author,
      artist,
      genre,
      status,
      description,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = extractSlug(mangaUrl);
    const url = `${this.baseUrl}/manga/${slug}`;
    const res = await this.get(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        Referer: `${this.baseUrl}/`,
      },
    });
    const $ = cheerio.load(res.data);
    const chapters: Chapter[] = [];

    $('ul.detail-chlist > li').each((_i, el) => {
      const link = $(el).find('a').first();
      const href = link.attr('href');
      if (!href) return;
      const fullUrl = href.startsWith('http') ? href : `${this.baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;
      const chapterName = link.text().trim();
      const numMatch = href.match(/\/c(\d+(?:\.\d+)?)/i);
      const chapterNumber = numMatch ? parseFloat(numMatch[1]) : undefined;

      const dateStr = $(el).find('span.time').first().text().trim();
      const dateUpload = dateStr ? new Date(dateStr).getTime() : undefined;

      chapters.push({
        name: chapterName || `Chapter ${chapterNumber ?? ''}`,
        url: fullUrl,
        chapterNumber,
        dateUpload: Number.isFinite(dateUpload) ? dateUpload : undefined,
      });
    });

    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        Referer: `${this.baseUrl}/`,
      },
    });
    const html = String(res.data);
    const cidMatch = html.match(/var\s+chapter_id\s*=\s*(\d+)/i);
    const countMatch = html.match(/var\s+imagecount\s*=\s*(\d+)/i);
    if (!cidMatch) return [];

    const cid = cidMatch[1];
    const imageCount = countMatch ? parseInt(countMatch[1], 10) : 1;
    const pages: Page[] = [];

    // Fetch page 1 chapterfun script to unpack images
    const baseChapterUrl = chapterUrl.replace(/\/$/, '');
    try {
      const ashxRes = await this.get(`${baseChapterUrl}/chapterfun.ashx?cid=${cid}&page=1&key=`, {
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          Referer: chapterUrl,
        },
      });
      const script = String(ashxRes.data);
      const code = script.replace(/^eval\s*/, 'return ');
      const unpacked = (new Function(code))();
      if (typeof unpacked === 'string') {
        const pixMatch = unpacked.match(/var\s+pix\s*=\s*"([^"]+)"/);
        const pvalMatch = unpacked.match(/var\s+pvalue\s*=\s*(\[[^\]]+\])/);
        if (pixMatch && pvalMatch) {
          const pix = pixMatch[1];
          const arr: string[] = JSON.parse(pvalMatch[1].replace(/'/g, '"'));
          arr.forEach((file, index) => {
            const host = pix.startsWith('//') ? `https:${pix}` : pix;
            pages.push({ index, imageUrl: `${host}${file}` });
          });
        }
      }
    } catch {
      // Fallback if unpack fails
    }

    if (pages.length === 0 && imageCount > 0) {
      for (let i = 0; i < imageCount; i++) {
        pages.push({ index: i, imageUrl: `${baseChapterUrl}/chapterfun.ashx?cid=${cid}&page=${i + 1}&key=` });
      }
    }

    return pages;
  }
}
