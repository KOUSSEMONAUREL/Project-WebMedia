import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface CorpusEntry {
  id: string;
  title: string;
  alias?: string[];
  authors?: string[];
  genres?: string[];
  year?: number | null;
  rating?: number | null;
  nb_tomes?: number | null;
  popularity?: number | null;
  cover?: string | null;
}

interface CorpusDto {
  docs: CorpusEntry[];
}

interface HomeConfigDto {
  upd: string;
}

interface UpdateEntry {
  s: string;
  t: string;
  c?: string | null;
}

interface UpdatesDto {
  g: UpdateEntry[];
}

interface PagesDto {
  pages: Array<{ url: string }>;
}

const PAGE_SIZE = 24;

export class BDplusScraper extends BaseScraper {
  readonly name = 'BDplus';
  readonly baseUrl = 'https://bdplus.cc';
  readonly lang = 'fr';

  private corpus: CorpusEntry[] | null = null;

  private async loadCorpus(): Promise<CorpusEntry[]> {
    if (!this.corpus) {
      const res = await this.get(`${this.baseUrl}/data/search_corpus.json`);
      this.corpus = (res.data as CorpusDto).docs;
    }
    return this.corpus;
  }

  private normalize(value: string): string {
    return value.normalize('NFD').replace(/\p{Mn}+/gu, '').toLowerCase();
  }

  private toManga(entry: CorpusEntry): Manga {
    return {
      title: entry.title,
      url: this.seriesUrl(entry.id),
      thumbnailUrl: entry.cover ? this.absUrl(entry.cover) : '',
      lang: this.lang,
    };
  }

  private paginate<T>(items: T[], page: number, transform: (item: T) => Manga): SearchResult {
    const start = (page - 1) * PAGE_SIZE;
    return {
      mangas: items.slice(start, start + PAGE_SIZE).map(transform),
      hasNextPage: items.length > page * PAGE_SIZE,
    };
  }

  private seriesUrl(slug: string): string {
    return `${this.baseUrl}/serie_static/${slug}.html`;
  }

  private slugFromUrl(mangaUrl: string): string {
    const segments = mangaUrl.split('?')[0].split('/').filter(Boolean);
    return (segments[segments.length - 1] ?? '').replace(/\.html$/, '');
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const entries = await this.loadCorpus();
    const sorted = [...entries].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
    return this.paginate(sorted, page, entry => this.toManga(entry));
  }

  async getLatest(page = 1): Promise<SearchResult> {
    const home = await this.get(this.baseUrl);
    const $home = this.$(home.data);
    const configText = $home('script#homeCfg').first().text();
    const config = JSON.parse(configText) as HomeConfigDto;
    const res = await this.get(this.absUrl(config.upd));
    const updates = (res.data as UpdatesDto).g ?? [];
    return this.paginate(updates, page, entry => ({
      title: entry.t,
      url: this.seriesUrl(entry.s),
      thumbnailUrl: entry.c ? this.absUrl(entry.c) : '',
      lang: this.lang,
    }));
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const entries = await this.loadCorpus();
    const term = this.normalize(query.trim());
    const filtered = term
      ? entries.filter(entry =>
          [entry.title, ...(entry.alias ?? []), ...(entry.authors ?? [])]
            .some(value => this.normalize(value).includes(term)))
      : entries;
    const sorted = [...filtered].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
    return this.paginate(sorted, page, entry => this.toManga(entry));
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const slug = this.slugFromUrl(mangaUrl);
    const res = await this.get(this.seriesUrl(slug));
    const $ = this.$(res.data);

    const title = $('h1#fhT').first().text().trim();
    const author = $('.fh-au b')
      .toArray()
      .map(element => $(element).text().trim())
      .filter(Boolean)
      .join(', ');
    const genre = $('.fh-meta a.pill.pg')
      .toArray()
      .map(element => $(element).contents().filter((_, node) => node.type === 'text').text().trim() || $(element).text().trim())
      .filter(Boolean)
      .join(', ');
    const description = $('p.fh-lead').first().text().trim();
    const thumbnailUrl = $('.fh-cov img').first().attr('src') || '';

    return {
      title: title || undefined,
      url: mangaUrl,
      author: author || undefined,
      genre: genre || undefined,
      description: description || undefined,
      thumbnailUrl: this.absUrl(thumbnailUrl),
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = this.slugFromUrl(mangaUrl);
    const res = await this.get(this.seriesUrl(slug));
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];

    $('#tl a.tr').each((_index, element) => {
      const $el = $(element);
      const key = $el.attr('data-k') || '';
      if (!key) return;
      const name = [
        $el.find('.tn').first().text().trim(),
        $el.find('.tt').first().text().trim(),
      ].filter(Boolean).join(' : ');
      const numberMatch = /(\d+(?:\.\d+)?)/.exec($el.attr('data-n') || name);
      chapters.push({
        name: name || key,
        url: key,
        chapterNumber: numberMatch ? Number.parseFloat(numberMatch[1]) : undefined,
      });
    });

    return chapters.reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const path = chapterUrl
      .replace(/^https?:\/\/[^/]+\//i, '')
      .replace(/^\/+|\/+$/g, '');
    const tomeUrl = `${this.baseUrl}/_converted/${path}`;
    const res = await this.get(`${tomeUrl}/pages.json`);
    const pages = (res.data as PagesDto).pages ?? [];

    return pages.map((page, index) => ({
      index,
      imageUrl: page.url.startsWith('/') ? this.absUrl(page.url) : `${tomeUrl}/${page.url}`,
    }));
  }
}

export default BDplusScraper;
