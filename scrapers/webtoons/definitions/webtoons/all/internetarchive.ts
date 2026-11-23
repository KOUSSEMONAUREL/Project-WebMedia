import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, Page, SearchResult } from '../../../engine/types';

interface SearchDoc {
  identifier: string;
  title?: string;
}

interface SearchResponse {
  response: {
    numFound: number;
    docs: SearchDoc[];
  };
}

interface ArchiveFile {
  name: string;
  source?: string;
  format?: string;
  original?: string;
  title?: string;
  mtime?: string;
}

interface ArchiveMetadata {
  identifier?: string;
  title?: string;
  mediatype?: string;
  creator?: string | string[];
  subject?: string | string[];
  language?: string | string[];
  description?: string | string[];
  date?: string;
  'access-restricted-item'?: string;
}

interface ArchiveItem {
  server?: string;
  dir?: string;
  files: ArchiveFile[];
  metadata?: ArchiveMetadata;
}

interface BookReaderResponse {
  data: {
    brOptions: {
      data: Array<Array<{ uri: string }>>;
    };
  };
}

const PAGE_SIZE = 24;
const MAX_RESULTS = 10000;
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);

export class InternetArchiveScraper extends BaseScraper {
  readonly name = 'Internet Archive';
  readonly baseUrl = 'https://archive.org';
  readonly lang = 'all';

  async getPopular(page = 1): Promise<SearchResult> {
    return this.search('', 'downloads desc', page);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.search('', 'addeddate desc', page);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (/^https?:\/\//.test(query)) {
      const parsed = new URL(query);
      if (!parsed.hostname.endsWith('archive.org')) throw new Error('Unsupported url');
      const identifier = parsed.pathname.split('/').filter(Boolean)[1];
      if (!identifier) throw new Error('Unsupported url');
      const details = await this.getMangaDetails(this.detailsUrl(identifier));
      return {
        mangas: [{ ...details, title: details.title || identifier, url: this.detailsUrl(identifier) } as Manga],
        hasNextPage: false,
      };
    }
    return this.search(query.trim(), 'downloads desc', page);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const id = this.identifier(mangaUrl);
    const item = await this.item(id);
    const metadata = item.metadata || {};
    return {
      title: metadata.title || id,
      url: this.detailsUrl(id),
      thumbnailUrl: `${this.baseUrl}/services/img/${encodeURIComponent(id)}`,
      author: this.list(metadata.creator).join(', ') || undefined,
      genre: this.list(metadata.subject).join(', ') || undefined,
      description: this.list(metadata.description).join('\n').replace(/<[^>]+>/g, '') || undefined,
      status: undefined,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const id = this.identifier(mangaUrl);
    const item = await this.item(id);
    if (item.metadata?.['access-restricted-item'] === 'true') {
      throw new Error('This item is lending-only on the Internet Archive');
    }

    const byName = new Map(item.files.map(file => [file.name, file]));
    const books = item.files.filter(file => file.format?.startsWith('Single Page Processed'));
    const chapters = books.map(file => {
      const path = beforeLast(file.name, '_');
      const original = file.original ? byName.get(file.original) : undefined;
      return {
        name: original?.title || afterLast(path, '/'),
        url: `${this.detailsUrl(id)}/${path}`,
        dateUpload: Number(original?.mtime || file.mtime || 0) * 1000 || undefined,
      };
    });

    const folders = new Map<string, ArchiveFile[]>();
    for (const file of item.files) {
      if (!this.isImage(file)) continue;
      const folder = file.name.includes('/') ? beforeLast(file.name, '/') : '';
      folders.set(folder, [...(folders.get(folder) || []), file]);
    }
    for (const [folder, files] of folders) {
      chapters.push({
        name: afterLast(folder, '/') || 'Images',
        url: `${this.downloadUrl(id)}/${folder}`,
        dateUpload: Number(files[0].mtime || 0) * 1000 || undefined,
      });
    }

    return chapters
      .sort((a, b) => this.naturalKey(b.name).localeCompare(this.naturalKey(a.name)))
      .map(chapter => ({ ...chapter, chapterNumber: this.chapterNumber(chapter.name) }));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const parsed = new URL(chapterUrl);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const id = segments[1];
    const path = segments.slice(2).join('/');
    const item = await this.item(id);
    const server = item.server;
    const dir = item.dir;
    if (!server || !dir) throw new Error('This item is no longer on the Internet Archive');

    if (segments[0] === 'details') {
      return this.bookReaderPages(server, dir, id, path);
    }

    const prefix = `${path}/`;
    const files = item.files
      .filter(file => this.isImage(file) && (file.name === path || file.name.startsWith(prefix)))
      .sort((a, b) => this.naturalKey(a.name).localeCompare(this.naturalKey(b.name)));
    return files.map((file, index) => ({
      index,
      imageUrl: this.fileUrl(server, dir, file.name),
    }));
  }

  private async search(query: string, sort: string, page: number): Promise<SearchResult> {
    const terms = [];
    if (query) terms.push(`(${query})`);
    terms.push('mediatype:(texts OR image)');
    terms.push('NOT access-restricted-item:true');
    const url = this.apiUrl('/advancedsearch.php', {
      q: terms.join(' AND '),
      fl: 'identifier,title',
      rows: String(PAGE_SIZE),
      page: String(page),
      output: 'json',
      'sort[]': sort,
    });
    const res = await this.get(url);
    const data = res.data as SearchResponse;
    const docs = data.response?.docs || [];
    return {
      mangas: docs.map(doc => ({
        title: doc.title || doc.identifier,
        url: this.detailsUrl(doc.identifier),
        thumbnailUrl: `${this.baseUrl}/services/img/${encodeURIComponent(doc.identifier)}`,
        lang: this.lang,
      })),
      hasNextPage: page * PAGE_SIZE < Math.min(data.response?.numFound || 0, MAX_RESULTS),
    };
  }

  private async item(identifier: string): Promise<ArchiveItem> {
    const res = await this.get(this.apiUrl(`/metadata/${encodeURIComponent(identifier)}`, {}));
    return res.data as ArchiveItem;
  }

  private async bookReaderPages(
    server: string,
    dir: string,
    identifier: string,
    subPrefix: string,
  ): Promise<Page[]> {
    const url = new URL(`https://${server}/BookReader/BookReaderJSIA.php`);
    url.searchParams.set('id', identifier);
    url.searchParams.set('itemPath', dir);
    url.searchParams.set('server', server);
    url.searchParams.set('format', 'json');
    url.searchParams.set('subPrefix', subPrefix);
    const res = await this.get(url.toString());
    const data = res.data as BookReaderResponse;
    return data.data.brOptions.data
      .flat()
      .map((entry, index) => ({ index, imageUrl: entry.uri }));
  }

  private apiUrl(path: string, params: Record<string, string>): string {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  private detailsUrl(identifier: string): string {
    return `${this.baseUrl}/details/${encodeURIComponent(identifier)}`;
  }

  private downloadUrl(identifier: string): string {
    return `${this.baseUrl}/download/${encodeURIComponent(identifier)}`;
  }

  private fileUrl(server: string, dir: string, name: string): string {
    const url = new URL(`https://${server}`);
    url.pathname = [dir, ...name.split('/')]
      .join('/')
      .split('/')
      .filter(Boolean)
      .map(part => `/${encodeURIComponent(part)}`)
      .join('');
    return url.toString();
  }

  private identifier(url: string): string {
    const match = url.match(/\/(?:details|download|stream)\/([^/?#]+)/);
    if (!match) throw new Error('Unsupported url');
    return decodeURIComponent(match[1]);
  }

  private isImage(file: ArchiveFile): boolean {
    return file.source === 'original' && IMAGE_EXTENSIONS.has(
      afterLast(file.name, '.').toLowerCase(),
    );
  }

  private list(value?: string | string[]): string[] {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  }

  private chapterNumber(name: string): number | undefined {
    const value = Number(name.match(/\d+(?:\.\d+)?/)?.[0]);
    return Number.isFinite(value) ? value : undefined;
  }

  private naturalKey(name: string): string {
    return name.toLowerCase().replace(/\d+/g, value => value.padStart(20, '0'));
  }
}

function beforeLast(value: string, separator: string): string {
  const index = value.lastIndexOf(separator);
  return index >= 0 ? value.slice(0, index) : value;
}

function afterLast(value: string, separator: string): string {
  const index = value.lastIndexOf(separator);
  return index >= 0 ? value.slice(index + separator.length) : value;
}
