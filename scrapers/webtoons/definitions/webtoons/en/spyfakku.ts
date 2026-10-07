import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface Name {
  namespace: string;
  name: string;
}

interface Hentai {
  id: number;
  hash: string;
  title: string;
  thumbnail: number;
  pages: number;
  description?: string | null;
  fullTitle?: string;
  tags?: Name[] | null;
  size?: number;
  createdAt?: string | null;
  releasedAt?: string | null;
}

interface ShortHentai {
  hash: string;
  title: string;
  thumbnail: number;
  description?: string | null;
  releasedAt?: string | null;
  createdAt?: string | null;
  tags?: Name[] | null;
  size: number;
  pages: number;
}

interface HentaiLib {
  archives: Hentai[];
  page: number;
  limit: number;
  total: number;
}

interface NodeData {
  data: unknown[];
}

interface Nodes {
  nodes: NodeData[];
}

interface HentaiIndexes {
  hash: number;
  title: number;
  thumbnail: number;
  description: number;
  releasedAt: number;
  createdAt: number;
  tags: number;
  size: number;
  pages: number;
}

const ARCHIVE_REGEX = /^\/archive\/(\d+)\/.*/;

function buildFullTitle(title: string, tags: Name[] | null | undefined): string {
  const grouped: Record<string, string[]> = {};
  for (const t of tags ?? []) {
    if (!t.name.trim()) continue;
    (grouped[t.namespace] = grouped[t.namespace] ?? []).push(t.name);
  }
  const circle = grouped['circle']?.join(' & ');
  const artist = grouped['artist']?.join(' & ');
  const magazine = grouped['magazine']?.join(' & ');
  let out = '';
  if (circle) out += `[${circle}${artist ? ` (${artist})` : ''}] `;
  else if (artist) out += `[${artist}] `;
  out += title;
  if (magazine) out += ` (${magazine})`;
  return out;
}

export class SpyFakkuScraper extends BaseScraper {
  readonly name = 'SpyFakku';
  readonly baseUrl = 'https://hentalk.pw';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(`/api/library?sort=released_at&page=${page}`);
    return this.libraryToResults(res.data as HentaiLib);
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const res = await this.get(`/api/library?sort=created_at&page=${page}`);
    return this.libraryToResults(res.data as HentaiLib);
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const q = query.trim();
    const res = await this.get(`/api/library?q=${encodeURIComponent(q)}&page=${page}`);
    return this.libraryToResults(res.data as HentaiLib);
  }

  private libraryToResults(library: HentaiLib): SearchResult {
    const mangas: Manga[] = (library.archives ?? []).map((h) => ({
      title: h.title,
      url: `/g/${h.id}?${h.pages}&hash=${h.hash}`,
      thumbnailUrl: `${this.baseUrl}/image/${h.hash}/${h.thumbnail}?type=cover`,
      lang: this.lang,
      genre: (h.tags ?? []).filter((t) => t.namespace === 'tag').map((t) => t.name).join(', ') || undefined,
    }));
    return { mangas, hasNextPage: library.page * library.limit < library.total };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const add = await this.getShortHentai(mangaUrl);
    const tags = add.tags ?? [];
    const grouped: Record<string, string[]> = {};
    for (const t of tags) (grouped[t.namespace] = grouped[t.namespace] ?? []).push(t.name);

    const descParts: string[] = [];
    if (add.description) descParts.push(add.description, '');
    if (grouped['circle']?.length) descParts.push(`Circles: ${grouped['circle'].join(', ')}`);
    if (grouped['publisher']?.length) descParts.push(`Publishers: ${grouped['publisher'].join(', ')}`);
    if (grouped['magazine']?.length) descParts.push(`Magazines: ${grouped['magazine'].join(', ')}`);
    if (grouped['event']?.length) descParts.push(`Events: ${grouped['event'].join(', ')}`, '');
    if (grouped['parody']?.length) descParts.push(`Parodies: ${grouped['parody'].join(', ')}`);
    descParts.push('', `Pages: ${add.pages}`);
    if (add.releasedAt) descParts.push('', `Released: ${add.releasedAt.substring(0, 19)}`);
    if (add.createdAt) descParts.push(`Added: ${add.createdAt.substring(0, 19)}`);
    const size = add.size ?? 0;
    const sizeStr = size >= 300 * 1000 * 1000 ? `${(size / 1e9).toFixed(2)} GB`
      : size >= 100 * 1000 ? `${(size / 1e6).toFixed(2)} MB`
      : size >= 1000 ? `${(size / 1e3).toFixed(2)} kB` : `${size} B`;
    descParts.push(`Size: ${sizeStr}`);

    return {
      title: add.title,
      author: (grouped['circle'] ?? grouped['artist'])?.join(', '),
      artist: grouped['artist']?.join(', '),
      genre: grouped['tag']?.join(', '),
      thumbnailUrl: `${this.baseUrl}/image/${add.hash}/${add.thumbnail}?type=cover`,
      description: descParts.join('\n').trim(),
      status: 2,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const add = await this.getShortHentai(mangaUrl);
    return [{
      name: 'Chapter',
      url: `${this.archivePath(mangaUrl)}?${add.pages}&hash=${add.hash}`,
      dateUpload: add.releasedAt ? Date.parse(add.releasedAt) : undefined,
    }];
  }

  private archivePath(url: string): string {
    return url.replace(ARCHIVE_REGEX, '/g/$1').split('?')[0];
  }

  private async getShortHentai(mangaUrl: string): Promise<ShortHentai> {
    const path = this.archivePath(mangaUrl);
    const apiPath = '/api' + path;
    try {
      const res = await this.get(apiPath);
      if (res?.data && typeof res.data === 'object' && (res.data as ShortHentai).hash) {
        return res.data as ShortHentai;
      }
    } catch { /* fall through to __data.json */ }
    for (let i = 0; i < 3; i++) {
      try {
        const res = await this.get(`${path}/__data.json`);
        const nodes = res.data as Nodes;
        return this.getAdditionals(nodes.nodes[nodes.nodes.length - 1].data as unknown[]);
      } catch { /* retry */ }
    }
    throw new Error('SpyFakku: Failed to fetch details');
  }

  private getAdditionals(data: unknown[]): ShortHentai {
    const arr = data;
    const hentaiIndexes = arr[1] as HentaiIndexes;
    const idx = (i: unknown): number => (typeof i === 'object' && i !== null && 'index' in i ? (i as { index: number }).index : i as number);
    const hash = String(arr[hentaiIndexes.hash]);
    const title = String(arr[hentaiIndexes.title]);
    const thumbnail = Number(arr[hentaiIndexes.thumbnail]);
    const description = arr[hentaiIndexes.description] as string | null;
    const releasedAt = String(arr[hentaiIndexes.releasedAt]);
    const createdAt = String(arr[hentaiIndexes.createdAt]);
    const size = Number(arr[hentaiIndexes.size]);
    const pages = Number(arr[hentaiIndexes.pages]);
    const tagsRaw = arr[hentaiIndexes.tags];
    const tags: Name[] = [];
    if (Array.isArray(tagsRaw)) {
      for (const t of tagsRaw) {
        const n = typeof t === 'object' && t !== null && 'int' in t ? (t as { int: number }).int : (typeof t === 'number' ? t : -1);
        if (n >= 0) {
          const ns = arr[n + 2];
          const nm = arr[n + 3];
          if (typeof ns === 'string' && typeof nm === 'string') tags.push({ namespace: ns, name: nm });
        }
      }
    }
    return { hash, title, thumbnail, description, releasedAt, createdAt, size, pages, tags };
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    if (!chapterUrl.includes('hash=')) {
      const add = await this.getShortHentai(chapterUrl);
      return Array.from({ length: add.pages }, (_, i) => ({
        index: i,
        imageUrl: `${this.baseUrl}/image/${add.hash}/${i + 1}`,
      }));
    }
    const hash = chapterUrl.split('hash=')[1]?.split('&')[0] ?? '';
    const pages = Number(chapterUrl.split('?')[1]?.split('&')[0]);
    return Array.from({ length: pages }, (_, i) => ({
      index: i,
      imageUrl: `${this.baseUrl}/image/${hash}/${i + 1}`,
    }));
  }
}
