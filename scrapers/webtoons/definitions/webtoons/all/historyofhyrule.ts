import type { CheerioAPI } from 'cheerio';
import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

const CATEGORIES = [
  ['Manga', 'manga'],
  ['Doujinshi', 'doujinshi'],
  ['Comics', 'comics'],
  ['4koma', '4koma'],
  ['Novels & Books', 'book'],
  ['Zines', 'zines'],
  ['Guides', 'guide'],
  ['Misc', 'misc'],
] as const;

const PAGE_FILE = /(\d+)([a-z]?)\.(jpe?g|png|gif)/i;
const COVER_FILE = /cover\.(?:jpe?g|png|gif)/i;
const BACK_FILE = /back\.(?:jpe?g|png|gif)/i;
const LANGUAGE_LINK = /(?:in|for the) ([A-Z][a-z]+)/;
const AUTHOR_LABEL = /^(?:Artist or Circle|Artist|Author|Circle)\b/;

interface Field {
  label: string;
  value: string;
}

export class HistoryOfHyruleScraper extends BaseScraper {
  readonly name = 'History of Hyrule';
  readonly baseUrl = 'https://historyofhyrule.com';
  readonly lang = 'en';

  private async getCategory(category: string): Promise<Manga[]> {
    const listUrl = `${this.baseUrl}/publications/${category}_index.php`;
    const res = await this.get(listUrl);
    const $ = this.$(String(res.data));
    $('p:has(a[name=unobtained]) + table').remove();

    const seen = new Set<string>();
    const mangas: Manga[] = [];
    $('a:has(img[src*=thumb])')
      .toArray()
      .forEach(element => {
        const link = $(element);
        const folder = this.publicationFolder(link.attr('href') ?? '', listUrl);
        if (!folder || seen.has(folder)) return;
        const title = link.closest('tr').next().text().trim();
        if (!title) return;
        seen.add(folder);
        const cover = link.find('img').first().attr('src') ?? '';
        mangas.push({
          title,
          url: `${this.baseUrl}/publications/${folder}/`,
          thumbnailUrl: cover ? new URL(cover, listUrl).toString() : '',
          lang: 'en',
        });
      });
    return mangas;
  }

  async getPopular(_page = 1): Promise<SearchResult> {
    const lists = await Promise.all(CATEGORIES.map(([, category]) => this.getCategory(category)));
    return { mangas: this.dedupe(lists.flat()), hasNextPage: false };
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getPopular(page);
  }

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const term = query.trim().toLowerCase();
    const { mangas } = await this.getPopular();
    return {
      mangas: term ? mangas.filter(manga => manga.title.toLowerCase().includes(term)) : mangas,
      hasNextPage: false,
    };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const url = this.absUrl(mangaUrl).replace(/\/?$/, '/');
    const res = await this.get(`${url}index.html`);
    const $ = this.$(String(res.data));
    const fields = this.readFields($);
    const title = fields.find(field => field.label === 'Title')?.value ?? 'Title';
    const version = $('#info p strong')
      .toArray()
      .map(element => $(element).text().trim())
      .find(text => /version/i.test(text));
    const thumbnail = $('img[src^=pages/]').first().attr('src') ?? '';
    const description = fields
      .filter(field => field.label !== 'Title' && !AUTHOR_LABEL.test(field.label))
      .map(field => `${field.label}: ${field.value}`)
      .join('\n\n');

    return {
      title,
      url,
      thumbnailUrl: thumbnail ? new URL(thumbnail, url).toString() : undefined,
      author:
        fields
          .find(field => AUTHOR_LABEL.test(field.label))
          ?.value.trim(),
      description: [version, description].filter(Boolean).join('\n\n') || undefined,
      status: 0,
      lang: 'en',
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const url = this.absUrl(mangaUrl).replace(/\/?$/, '/');
    const res = await this.get(`${url}index.html`);
    const $ = this.$(String(res.data));
    const version = $('#info p strong')
      .toArray()
      .map(element => $(element).text().trim())
      .find(text => /version/i.test(text));
    const chapters: Chapter[] = [
      {
        name: version?.replace(/^The\s+|^An\s+/i, '').replace(/[!.]*$/, '') || 'Chapter',
        url,
      },
    ];

    $('a:has(img[src*=/extras/flags/])')
      .toArray()
      .forEach(element => {
        const link = $(element);
        const folder = this.publicationFolder(link.attr('href') ?? '', `${url}index.html`);
        if (!folder) return;
        const language = LANGUAGE_LINK.exec(link.closest('p').text() || link.text())?.[1];
        if (!language) return;
        chapters.push({
          name: `${language} Language Version`,
          url: `${this.baseUrl}/publications/${folder}/`,
        });
      });

    return chapters.filter(
      (chapter, index) => chapters.findIndex(item => item.url === chapter.url) === index,
    );
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const base = this.absUrl(chapterUrl).replace(/\/?$/, '/');
    const pagesUrl = `${base}pages/`;
    const res = await this.get(pagesUrl);
    const $ = this.$(String(res.data));
    const files = $('a[href]')
      .toArray()
      .map(element => $(element).attr('href') ?? '');
    const numbered = files
      .map(file => {
        const match = PAGE_FILE.exec(file);
        if (!match) return undefined;
        return {
          file,
          number: Number.parseInt(match[1] ?? '0', 10),
          suffix: match[2] ?? '',
          png: (match[3] ?? '').toLowerCase() === 'png',
        };
      })
      .filter((entry): entry is { file: string; number: number; suffix: string; png: boolean } => Boolean(entry))
      .sort((a, b) => a.number - b.number || a.suffix.localeCompare(b.suffix) || Number(a.png) - Number(b.png));

    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const entry of numbered) {
      const key = `${entry.number}:${entry.suffix}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ordered.push(entry.file);
    }

    const cover = files.find(file => COVER_FILE.test(file));
    const back = files.find(file => BACK_FILE.test(file));
    return [...(cover ? [cover] : []), ...ordered, ...(back ? [back] : [])].map((file, index) => ({
      index,
      imageUrl: new URL(file, pagesUrl).toString(),
    }));
  }

  private dedupe(mangas: Manga[]): Manga[] {
    const unique = new Map<string, Manga>();
    for (const manga of mangas) if (!unique.has(manga.url)) unique.set(manga.url, manga);
    return [...unique.values()];
  }

  private publicationFolder(link: string, base: string): string | undefined {
    const url = new URL(link, base);
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments[0] !== 'publications' || !segments[1] || segments[1].includes('.')) return undefined;
    const page = segments[2];
    if (page && !page.endsWith('.html')) return undefined;
    return segments[1];
  }

  private readFields($: CheerioAPI): Field[] {
    const fields: Field[] = [];
    $('#info p, #contrib p').each((_, paragraph) => {
      let label = '';
      const parts: string[] = [];
      $(paragraph)
        .contents()
        .each((_, node) => {
          if (node.type === 'tag' && node.name === 'strong' && !label) {
            label = $(node).text().replace(/:$/, '').trim();
          } else {
            parts.push($(node).text());
          }
        });
      const value = parts.join('').replace(/^:\s*/, '').trim();
      if (label && value) fields.push({ label, value });
    });
    return fields;
  }
}
