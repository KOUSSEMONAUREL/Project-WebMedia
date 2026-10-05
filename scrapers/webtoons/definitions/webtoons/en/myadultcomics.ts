import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

// Transcompilation of keiyoushi src/en/myadultcomics (MyAdultComics.kt,
// KeiSource, libVersion 1.6). The previous port was a generic stub (bare
// `a`/`img` selectors, wrong class name, no search); this follows the
// upstream endpoints and selectors exactly.
//
// Two upstream features have no equivalent in our engine contract and are
// deliberately not ported: `supportsRelatedMangas` (no related-manga hook
// in BaseScraper) and the chapter `memo` page cache (our getPageList
// re-parses the `let template` script from the chapter URL instead — same
// pages, one extra request).
const PAGE_PATH_REGEX = /src=["'](books\/[^"']+)["']/g;

function parsePagePaths(scriptBody: string): string[] {
  const out: string[] = [];
  const re = new RegExp(PAGE_PATH_REGEX);
  let match: RegExpExecArray | null;
  while ((match = re.exec(scriptBody)) !== null) out.push(`/${match[1]}`);
  return out;
}

export class MyAdultComicsScraper extends BaseScraper {
  readonly name = 'MyAdultComics';
  readonly baseUrl = 'https://myadultcomics.com';
  readonly lang = 'en';

  private parseMangaList(html: string): SearchResult {
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('td.list_container').each((_i, element) => {
      const $el = $(element);
      const link = $el.find('p.text_container > a').first();
      const title = link.text().trim();
      const href = link.attr('href') ?? '';
      if (!href || !title) return;
      mangas.push({
        title,
        url: this.absUrl(href).replace(this.baseUrl, ''),
        thumbnailUrl: this.absUrl($el.find('img.fon_pic_img').first().attr('src') ?? ''),
        lang: this.lang,
      });
    });
    return { mangas, hasNextPage: $('td.tbl_page a:contains(">>")').length > 0 };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/index.php?page=${page}`);
    return this.parseMangaList(res.data);
  }

  async getLatest(_page = 1): Promise<SearchResult> {
    // Upstream declares `supportsLatest = false`.
    throw new Error(`${this.name}: getLatest() not implemented`);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    // Upstream `Filters` select: title search by default (`name` + search=yes),
    // other modes pass `search=<query>` + `sort=<mode>`. Our engine has no
    // filter UI, so text search always uses the title mode.
    const params = new URLSearchParams();
    if (query.trim()) params.append('name', query.trim());
    params.append('search', 'yes');
    params.append('page', String(page));
    const res = await this.get(`${this.baseUrl}/index.php?${params.toString()}`);
    return this.parseMangaList(res.data);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const script = $('script:contains("let template")').first().html() ?? '';
    const pagePaths = parsePagePaths(script);
    const first = pagePaths[0];
    let thumbnailUrl = '';
    if (first) {
      const segments = first.split('/').filter(Boolean);
      if (segments.length >= 2) {
        const name = segments[segments.length - 2];
        const ext = segments[segments.length - 1].split('.').pop() ?? 'jpg';
        thumbnailUrl = `${this.baseUrl}/poster/${name}.${ext}`;
      }
    }
    const genre = $('p.text_info_book:contains("Tags:") a')
      .map((_i, el) => $(el).text().trim())
      .get()
      .join(', ');
    const artist = $('p.text_info_book:contains("Artists:") a')
      .map((_i, el) => $(el).text().trim())
      .get()
      .join(', ');
    return {
      title: $('h1#TOP').first().text().trim(),
      url: mangaUrl,
      thumbnailUrl,
      genre: genre || undefined,
      artist: artist || undefined,
      author: artist || undefined,
      status: 0,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    // Single-gallery site: exactly one "Gallery" chapter per title, like upstream.
    return [{ name: 'Gallery', url: mangaUrl }];
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    const script = $('script:contains("let template")').first().html() ?? '';
    return parsePagePaths(script).map((path, index) => ({
      index,
      imageUrl: `${this.baseUrl}${path}`,
    }));
  }
}
