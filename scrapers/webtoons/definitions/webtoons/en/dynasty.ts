// @ts-nocheck
import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const CHAPTERS_DIR = 'chapters';
const SERIES_DIR = 'series';
const DOUJINS_DIR = 'doujins';

interface BrowseTag {
  type: string;
  name: string;
  permalink: string;
}

interface BrowseChapter {
  title: string;
  permalink: string;
  tags: BrowseTag[];
}

interface BrowseResponse {
  chapters: BrowseChapter[];
  current_page: number;
  total_pages: number;
}

interface MangaResponse {
  name: string;
  type: string;
  permalink: string;
  tags: BrowseTag[];
  cover?: string | null;
  description?: string | null;
  aliases?: string[];
  taggings: unknown[];
  total_pages: number;
}

interface ChapterPage {
  url: string;
}

interface ChapterResponse {
  title: string;
  permalink: string;
  tags: BrowseTag[];
  pages: ChapterPage[];
  releasedOn: string;
}

function permalinkToTitle(p: string): string {
  return p.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function resolveEntryPath(directory: string, permalink: string): [string, string] {
  if (directory !== CHAPTERS_DIR) return [directory, permalink];
  const m = permalink.match(/^(.*?)_(ch[0-9_]+|volume_[0-9_\w]+)$/);
  if (!m) return [directory, permalink];
  return [SERIES_DIR, m[1]];
}

function buildCoverUrl(file: string, baseUrl: string): string {
  if (!file) return '';
  if (file.startsWith('http')) return file;
  const path = file.startsWith('/') ? file : `/${file}`;
  if (path.startsWith('/system/')) return `${baseUrl}${path}`;
  return `${baseUrl}/system/tag_contents_covers/000${path}`;
}

export class DynastyScraper extends BaseScraper {
  readonly name = 'Dynasty Scans';
  readonly baseUrl = 'https://dynasty-scans.com';
  readonly lang = 'en';

  async getPopular(page = 1): Promise<SearchResult> {
    if (page === 1) {
      const res = await this.get(this.baseUrl, { headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } });
      const $ = this.$(res.data as string);
      const entries: Manga[] = [];
      $('h4:contains(Most Popular of Past 7 Days) ~ ul.cover-list a.thumbnail').each((_: unknown, el: unknown) => {
        const href = $((el as unknown) as Parameters<ReturnType<BaseScraper['$']>>[0]).attr('href') ?? '';
        try {
          const u = new URL(href, this.baseUrl);
          const segs = u.pathname.split('/').filter(Boolean);
          const permalink = segs[1] ?? '';
          if (!permalink) return;
          const [dir, resolved] = resolveEntryPath(CHAPTERS_DIR, permalink);
          entries.push({
            title: permalinkToTitle(resolved),
            url: `/${dir}/${resolved}`,
            thumbnailUrl: '',
            lang: this.lang,
          });
        } catch { /* ignore */ }
      });
      const distinct = [...new Map(entries.map((e) => [e.url, e])).values()];
      return { mangas: distinct, hasNextPage: true };
    }
    const res = await this.get(`${this.baseUrl}/${CHAPTERS_DIR}/added.json?page=${page - 1}`);
    const data = (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as BrowseResponse;
    const mangas = this.parseAddedChapters(data).map((e) => ({
      title: e.title,
      url: e.url,
      thumbnailUrl: e.cover ? buildCoverUrl(e.cover, this.baseUrl) : '',
      lang: this.lang,
    } as Manga));
    const hasNextPage = (data.current_page ?? 0) <= (data.total_pages ?? 0);
    return { mangas, hasNextPage };
  }

  private parseAddedChapters(data: BrowseResponse): { title: string; url: string; cover: string | null }[] {
    const seen = new Map<string, { title: string; url: string; cover: string | null }>();
    for (const chapter of data.chapters ?? []) {
      let isSeries = false;
      for (const tag of chapter.tags ?? []) {
        if (['Series', 'Anthology', 'Doujin', 'Issue'].includes(tag.type)) {
          const dir = tag.type === 'Series' ? SERIES_DIR : tag.type === 'Anthology' ? 'anthologies' : tag.type === 'Doujin' ? DOUJINS_DIR : 'issues';
          const key = `/${dir}/${tag.permalink}`;
          if (!seen.has(key)) seen.set(key, { title: tag.name, url: key, cover: null });
          if (tag.type === 'Series') isSeries = true;
        }
      }
      if (!isSeries) {
        const key = `/${CHAPTERS_DIR}/${chapter.permalink}`;
        if (!seen.has(key)) seen.set(key, { title: chapter.title, url: key, cover: null });
      }
    }
    return [...seen.values()];
  }

  async getLatest(_page = 1): Promise<SearchResult> {
    throw new Error('DynastyScans: use search or popular');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.set('q', query);
    if (page > 1) url.searchParams.set('page', String(page));
    const res = await this.get(url.toString());
    const $ = this.$(res.data as string);
    const entries: Manga[] = [];
    const seen = new Set<string>();
    $('.chapter-list a.name[href], .chapter-list .doujin_tags a[href]').each((_: unknown, el: unknown) => {
      const href = $(el).attr('href') ?? '';
      try {
        const u = new URL(href, this.baseUrl);
        const segs = u.pathname.split('/').filter(Boolean);
        if (segs.length < 2) return;
        let [directory, permalink] = [segs[0], segs[1]];
        const [rDir, rPerm] = resolveEntryPath(directory, permalink);
        directory = rDir;
        permalink = rPerm;
        const urlPath = `/${directory}/${permalink}`;
        if (seen.has(urlPath)) return;
        seen.add(urlPath);
        const title = ($(el).text() ?? '').trim() || permalinkToTitle(permalink);
        entries.push({ title, url: urlPath, thumbnailUrl: '', lang: this.lang });
      } catch { /* ignore */ }
    });
    const hasNextPage = $('.pagination [rel=next]').length > 0;
    return { mangas: entries, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const u = new URL(mangaUrl.startsWith('http') ? mangaUrl : `${this.baseUrl}${mangaUrl}`);
    const segs = u.pathname.split('/').filter(Boolean);
    if (segs.length < 2) return { url: mangaUrl, title: '' };
    const [directory, permalink] = segs;
    const apiUrl = `${this.baseUrl}/${directory}/${permalink}.json`;
    const res = await this.get(apiUrl);
    const data = (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as MangaResponse & Partial<ChapterResponse>;
    if (directory === CHAPTERS_DIR) {
      const ch = data as unknown as ChapterResponse;
      return {
        title: ch.title ?? permalinkToTitle(permalink),
        url: mangaUrl,
        thumbnailUrl: ch.pages?.[0]?.url ? buildCoverUrl(ch.pages[0].url, this.baseUrl) : '',
        description: `Type: Chapter\nReleased: ${ch.releasedOn ?? ''}`,
        status: 2,
        lang: this.lang,
      };
    }
    const manga = data as MangaResponse;
    const description = manga.description ? manga.description.replace(/\\u([0-9A-Fa-f]{4})/g, (_: string, hex: string) => String.fromCharCode(parseInt(hex, 16))) : undefined;
    const genres = manga.tags?.filter((t) => t.type === 'General').map((t) => t.name).join(', ') ?? undefined;
    const authors = manga.tags?.filter((t) => t.type === 'Author').map((t) => t.name).join(', ') ?? undefined;
    const thumb = manga.cover ? buildCoverUrl(manga.cover, this.baseUrl) : '';
    return {
      title: manga.name ?? permalinkToTitle(permalink),
      url: mangaUrl,
      thumbnailUrl: thumb,
      description,
      genre: genres,
      author: authors,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const u = new URL(mangaUrl.startsWith('http') ? mangaUrl : `${this.baseUrl}${mangaUrl}`);
    const segs = u.pathname.split('/').filter(Boolean);
    if (segs.length < 2) return [];
    const [directory, permalink] = segs;
    const apiUrl = `${this.baseUrl}/${directory}/${permalink}.json`;
    const res = await this.get(apiUrl);
    const data = (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as MangaResponse & Partial<ChapterResponse>;
    if (directory === CHAPTERS_DIR) {
      const ch = data as unknown as ChapterResponse;
      const dateUpload = ch.releasedOn ? Date.parse(ch.releasedOn) : undefined;
      return [{ name: 'Chapter', url: `/${CHAPTERS_DIR}/${ch.permalink ?? permalink}`, chapterNumber: 1, dateUpload: Number.isNaN(dateUpload as number) ? undefined : dateUpload }];
    }
    const manga = data as MangaResponse & { taggings?: unknown[] };
    const taggings = (manga.taggings ?? []) as Array<Record<string, unknown>>;
    const chapters: Chapter[] = [];
    let header: string | null = null;
    for (const item of taggings) {
      if (item && typeof item === 'object' && 'header' in item) {
        header = (item as { header: string | null }).header;
        continue;
      }
      const ch = item as unknown as { title: string; permalink: string; tags: BrowseTag[]; releasedOn: string };
      if (!ch.permalink) continue;
      let name = header ? `${header} ${ch.title}` : ch.title;
      const chTags = ch.tags ?? [];
      const scanlator = chTags.filter((t) => t.type === 'Scanlator').map((t) => t.name).join(', ') || undefined;
      const dateUpload = ch.releasedOn ? Date.parse(ch.releasedOn) : undefined;
      chapters.push({
        name: name ?? ch.title ?? 'Chapter',
        url: `/${CHAPTERS_DIR}/${ch.permalink}`,
        chapterNumber: chapters.length + 1,
        dateUpload: Number.isNaN(dateUpload as number) ? undefined : dateUpload,
        scanlator,
      });
    }
    return chapters.reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const u = new URL(chapterUrl.startsWith('http') ? chapterUrl : `${this.baseUrl}${chapterUrl}`);
    const segs = u.pathname.split('/').filter(Boolean);
    if (segs.length < 2 || segs[0] !== CHAPTERS_DIR) throw new Error('Refresh Chapter List');
    const permalink = segs[1];
    const apiUrl = `${this.baseUrl}/${CHAPTERS_DIR}/${permalink}.json`;
    const res = await this.get(apiUrl);
    const data = (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as ChapterResponse;
    return (data.pages ?? []).map((p, index) => ({ index, imageUrl: `${this.baseUrl}${p.url}` }));
  }
}
