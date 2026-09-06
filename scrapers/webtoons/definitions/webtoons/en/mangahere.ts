import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

export class MangahereScraper extends BaseScraper {
  readonly name = 'Mangahere';
  readonly baseUrl = 'https://www.mangahere.cc';
  readonly lang = 'en';

  constructor() {
    super();
    this.client.defaults.headers.common['Cookie'] = 'isAdult=1';
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/directory/${page}.htm`);
    const $ = this.$(res.data);
    const mangas: Manga[] = $('.manga-list-1-list li').toArray().map((el) => {
      const $el = $(el);
      const link = $el.find('a').first();
      const thumb = $el.find('img.manga-list-1-cover').first();
      return {
        title: link.attr('title') || link.text().trim(),
        url: this.absUrl(link.attr('href') || ''),
        thumbnailUrl: this.absUrl(thumb.attr('src') || ''),
        lang: this.lang,
      };
    });
    const hasNextPage = $('div.pager-list-left a:last-child').length > 0;
    return { mangas, hasNextPage };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(`${this.baseUrl}/directory/${page}.htm?latest`);
    const $ = this.$(res.data);
    const mangas: Manga[] = $('.manga-list-1-list li').toArray().map((el) => {
      const $el = $(el);
      const link = $el.find('a').first();
      const thumb = $el.find('img.manga-list-1-cover').first();
      return {
        title: link.attr('title') || link.text().trim(),
        url: this.absUrl(link.attr('href') || ''),
        thumbnailUrl: this.absUrl(thumb.attr('src') || ''),
        lang: this.lang,
      };
    });
    const hasNextPage = $('div.pager-list-left a:last-child').length > 0;
    return { mangas, hasNextPage };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('title', query);
    params.set('stype', '1');
    const res = await this.get(`${this.baseUrl}/search?${params.toString()}`);
    const $ = this.$(res.data);
    const mangas: Manga[] = $('.manga-list-4-list > li').toArray().map((el) => {
      const $el = $(el);
      const titleEl = $el.find('.manga-list-4-item-title > a').first();
      const thumb = $el.find('img.manga-list-4-cover').first();
      return {
        title: titleEl.attr('title') || titleEl.text().trim(),
        url: this.absUrl(titleEl.attr('href') || ''),
        thumbnailUrl: this.absUrl(thumb.attr('src') || ''),
        lang: this.lang,
      };
    });
    const hasNextPage = $('div.pager-list-left a:last-child').length > 0;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const details: Partial<Manga> = {
      title: $('.detail-info-right-title-font').first().text().trim() || $('.detail-info-right-title').first().text().trim() || $('h1').first().text() || $('title').text() || '',
      url: mangaUrl,
      thumbnailUrl: this.absUrl($('img.detail-info-cover-img').first().attr('src') || ''),
      author: $('.detail-info-right-say > a').first().text().trim() || undefined,
      genre: $('.detail-info-right-tag-list > a').toArray().map((el) => $(el).text().trim()).filter(Boolean).join(', ') || undefined,
      description: $('.fullcontent').first().text().trim() || undefined,
      lang: this.lang,
    };
    const statusText = $('span.detail-info-right-title-tip').first().text();
    if (statusText.toLowerCase().includes('ongoing')) {
      details.status = 1 as MangaStatus;
    } else if (statusText.toLowerCase().includes('completed')) {
      details.status = 0 as MangaStatus;
    } else {
      details.status = 3 as MangaStatus;
    }
    return details;
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    return $('ul.detail-main-list > li').toArray().map((el) => {
      const $el = $(el);
      const link = $el.find('a').first();
      return {
        name: $el.find('a p.title3').first().text().trim(),
        url: this.absUrl(link.attr('href') || ''),
        dateUpload: this.parseChapterDate($el.find('a p.title2').first().text().trim()),
      };
    }).filter((ch) => ch.url && ch.name);
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const html = res.data as string;
    const $ = this.$(html);
    const link = this.absUrl(chapterUrl);
    const bar = $('script[src*="chapter_bar"]');

    if (bar.length > 0) {
      let script = '';
      $('script').toArray().forEach((el) => {
        if (!script) {
          const text = $(el).text();
          if (text.includes('function(p,a,c,k,e,d)')) script = text;
        }
      });
      const deobfuscatedScript = deobfuscate(script.replace(/^eval/, ''));
      const urls = deobfuscatedScript.split("newImgs=['")[1].split("'];")[0].split("','");
      const pages: Page[] = urls.map((s, index) => ({ imageUrl: `https:${s}`, index }));
      return this.dropLastIfBroken(pages);
    }

    const secretKey = this.extractSecretKey(html);
    const chapterIdStartLoc = html.indexOf('chapterid');
    const chapterId = html.substring(chapterIdStartLoc + 11, html.indexOf(';', chapterIdStartLoc)).trim();
    const pagesLinksElements = $('.pager-list-left > span').first().find('a');
    const pagesNumber = parseInt(pagesLinksElements.eq(pagesLinksElements.length - 2).attr('data-page') || '', 10);
    if (Number.isNaN(pagesNumber)) throw new Error('Could not determine chapter page count');
    const pageBase = link.substring(0, link.lastIndexOf('/'));

    const pages: Page[] = [];
    for (let i = 1; i <= pagesNumber; i++) {
      const pageUrl = `${pageBase}/chapterfun.ashx?cid=${chapterId}&page=${i}&key=${secretKey}#${link}`;
      pages.push({ index: i - 1, imageUrl: await this.getImageUrl(pageUrl) });
    }
    return this.dropLastIfBroken(pages);
  }

  private dropLastIfBroken(pages: Page[]): Page[] {
    if (pages.length < 2) return pages;
    const pageNumbers = pages.slice(-2).map((page) => {
      const img = page.imageUrl;
      if (!img) return null;
      const beforeDot = img.substring(0, img.lastIndexOf('.'));
      const afterSlash = beforeDot.substring(beforeDot.lastIndexOf('/') + 1);
      const n = parseInt(afterSlash.slice(-2), 10);
      return Number.isNaN(n) ? null : n;
    });
    if (pageNumbers[0] === null || pageNumbers[1] === null) return pages.slice(0, -1);
    if (
      pageNumbers[1]! - pageNumbers[0]! === 1 ||
      (pageNumbers[0] === 0 && pageNumbers[1] === 99)
    ) {
      return pages;
    }
    return pages.slice(0, -1);
  }

  private async getImageUrl(pageUrl: string): Promise<string> {
    const hashIdx = pageUrl.indexOf('#');
    const referer = pageUrl.substring(hashIdx + 1);
    const requestUrl = pageUrl.substring(0, hashIdx);
    const headers = {
      Referer: referer,
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'X-Requested-With': 'XMLHttpRequest',
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      const url = attempt === 0 ? requestUrl : requestUrl.replace(/key=[^&]*/, 'key=');
      const responseText = (await this.client.get(url, { headers })).data;
      if (responseText && String(responseText).length > 0) {
        return this.parseImageUrl(String(responseText));
      }
    }
    throw new Error('Empty image response');
  }

  private parseImageUrl(responseText: string): string {
    const deobfuscatedScript = deobfuscate(responseText.replace(/^eval/, ''));
    const baseLinkStart = deobfuscatedScript.indexOf('pix=');
    if (baseLinkStart < 0) throw new Error('Missing image host');
    const baseLinkEnd = deobfuscatedScript.indexOf(';', baseLinkStart + 5);
    if (baseLinkEnd <= baseLinkStart + 5) throw new Error('Invalid image host');
    const baseLink = deobfuscatedScript.substring(baseLinkStart + 5, baseLinkEnd - 1);

    const imageLinkStart = deobfuscatedScript.indexOf('pvalue=');
    if (imageLinkStart < 0) throw new Error('Missing image path');
    const imageLinkEnd = deobfuscatedScript.indexOf('"', imageLinkStart + 9);
    if (imageLinkEnd <= imageLinkStart + 9) throw new Error('Invalid image path');
    const imageLink = deobfuscatedScript.substring(imageLinkStart + 9, imageLinkEnd);

    return `https:${baseLink}${imageLink}`;
  }

  private extractSecretKey(html: string): string {
    const secretKeyScriptLocation = html.indexOf('eval(function(p,a,c,k,e,d)');
    if (secretKeyScriptLocation < 0) throw new Error('Secret key script not found');
    const secretKeyScriptEndLocation = html.indexOf('</script>', secretKeyScriptLocation);
    const secretKeyScript = html.substring(secretKeyScriptLocation, secretKeyScriptEndLocation).replace(/^eval/, '');
    const secretKeyDeobfuscatedScript = deobfuscate(secretKeyScript);
    const secretKeyStartLoc = secretKeyDeobfuscatedScript.indexOf("'");
    const secretKeyEndLoc = secretKeyDeobfuscatedScript.indexOf(';');
    const secretKeyResultScript = secretKeyDeobfuscatedScript.substring(secretKeyStartLoc, secretKeyEndLoc);
    return evalJsStringExpr(secretKeyResultScript);
  }

  private parseChapterDate(date: string): number {
    if (date.includes('Today') || date.includes(' ago')) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    if (date.includes('Yesterday')) {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };
    const m = date.match(/([A-Za-z]{3}) +(\d{1,2}), *(\d{4})/);
    if (m) {
      const month = months[m[1].toLowerCase()];
      if (month !== undefined) {
        const d = new Date(parseInt(m[3], 10), month, parseInt(m[2], 10));
        if (!Number.isNaN(d.getTime())) return d.getTime();
      }
    }
    return 0;
  }
}

function deobfuscate(script: string): string {
  const fnIdx = script.indexOf('function(p,a,c,k,e,d)');
  if (fnIdx < 0) throw new Error('Not a packer script');
  const open = script.indexOf('{', fnIdx);
  let depth = 0;
  let close = -1;
  for (let i = open; i < script.length; i++) {
    if (script[i] === '{') depth++;
    else if (script[i] === '}') {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  const after = script.substring(close + 1).trim();
  if (!after.startsWith('(')) throw new Error('No args paren');
  const argsStr = after.slice(1, after.lastIndexOf(')'));
  const parts = splitTop(argsStr);
  const packed = unquote(parts[0]);
  const a = parseInt(parts[1], 10);
  const c = parseInt(parts[2], 10);
  const k = words(parts[3]);
  return unpack(packed, a, c, k);
}

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  let inStr: string | null = null;
  let esc = false;
  for (const ch of s) {
    if (inStr) {
      cur += ch;
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inStr = ch;
      cur += ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
      cur += ch;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      cur += ch;
      continue;
    }
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function unquote(s: string): string {
  const t = s.trim();
  if (t.startsWith("'") || t.startsWith('"')) {
    const q = t[0];
    let out = '';
    let esc = false;
    for (let i = 1; i < t.length; i++) {
      const ch = t[i];
      if (esc) {
        out += ch;
        esc = false;
      } else if (ch === '\\') {
        esc = true;
      } else if (ch === q) {
        break;
      } else {
        out += ch;
      }
    }
    return out;
  }
  return t;
}

function words(arg: string): string[] {
  const t = arg.trim();
  const m = t.match(/^(['"])([\s\S]*?)\1\s*\.split\(\s*(['"])\|\3\s*\)$/);
  if (m) return m[2].split('|');
  if (t.startsWith('[')) {
    const body = t.slice(1, t.lastIndexOf(']'));
    return splitTop(body).map(unquote);
  }
  if (t.startsWith("'")) return unquote(t).split('|');
  return [];
}

function unpack(packed: string, a: number, c: number, k: string[]): string {
  const enc = (n: number): string => {
    const r = n % a;
    return (n < a ? '' : enc(Math.floor(n / a))) + (r > 35 ? String.fromCharCode(r + 29) : r.toString(36));
  };
  const dict: Record<string, string> = {};
  for (let i = 0; i < c; i++) {
    const tok = enc(i);
    dict[tok] = k[i] || tok;
  }
  return packed.replace(/\b(\w+)\b/g, (match) => dict[match] ?? match);
}

function evalJsStringExpr(expr: string): string {
  const literals: string[] = [];
  const re = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) literals.push(m[0]);
  return literals
    .map((lit) => lit.slice(1, -1).replace(/\\([\\'"])/g, '$1'))
    .join('');
}