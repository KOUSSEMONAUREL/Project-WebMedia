import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult, MangaStatus } from '../../../engine/types';

const BASE_URL = 'https://hentai-origines.com';
const MANGA_PATH = 'manga';

const DATE_REGEX = /(\d{1,2})\s+(\p{L}+)\.?\s+(\d{4})/u;

interface CatalogueResponseDto {
  success: boolean;
  data: {
    html?: string;
    more?: boolean;
  };
}

function monthNumber(month: string): number | undefined {
  const name = month.toLowerCase();
  if (name.startsWith('jan')) return 1;
  if (name.startsWith('fev') || name.startsWith('fév')) return 2;
  if (name.startsWith('mar')) return 3;
  if (name.startsWith('avr')) return 4;
  if (name.startsWith('mai')) return 5;
  if (name.startsWith('juin')) return 6;
  if (name.startsWith('juil')) return 7;
  if (name.startsWith('ao')) return 8;
  if (name.startsWith('sep')) return 9;
  if (name.startsWith('oct')) return 10;
  if (name.startsWith('nov')) return 11;
  if (name.startsWith('dec') || name.startsWith('déc')) return 12;
  return undefined;
}

function parseChapterDate(date: string | null | undefined): number | undefined {
  if (!date) return undefined;
  const match = DATE_REGEX.exec(date);
  if (!match) return undefined;
  const month = monthNumber(match[2]);
  if (!month) return undefined;
  const d = new Date(Date.UTC(parseInt(match[3], 10), month - 1, parseInt(match[1], 10)));
  if (isNaN(d.getTime())) return undefined;
  return d.getTime();
}

function mangaSlug(pathOrUrl: string): string {
  const cleaned = pathOrUrl.replace(/^https?:\/\/[^/]+/i, '');
  const path = cleaned.split('?')[0].split('#')[0];
  const segments = path.split('/').filter(Boolean);
  const known = new Set([MANGA_PATH, 'catalogues']);
  return segments.find(s => !known.has(s)) ?? path;
}

export class HentaioriginesScraper extends BaseScraper {
  readonly name = 'Hentai Origines';
  readonly baseUrl = BASE_URL;
  readonly lang = 'fr';

  private async getCatalogue(
    page: number,
    query = '',
    sort = 'recents'
  ): Promise<SearchResult> {
    const form = new URLSearchParams({
      action: 'madara_child_catalogue',
      s: query,
      genres: '',
      statut: 'tous',
      note: '0',
      origine: '',
      tri: sort,
      chmin: '0',
      chmax: '0',
      page: page.toString(),
      auteur: '',
      artiste: '',
      annee: '',
    });
    const res = await this.post('/wp-admin/admin-ajax.php', form.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const data = res.data as CatalogueResponseDto;
    const html = data?.data?.html ?? '';
    const $ = this.$(html);
    const mangas: Manga[] = [];
    $('a.ori-card').each((_, el) => {
      const $el = $(el);
      if (!$el.find('span.ori-card-title').length) return;
      const href = $el.attr('href') ?? '';
      const title = $el.find('span.ori-card-title').first().text().trim();
      const thumbnailUrl = $el.find('img').first().attr('src') ?? '';
      if (title && href) mangas.push({ title, url: href, thumbnailUrl, lang: this.lang });
    });
    return { mangas, hasNextPage: data?.data?.more ?? false };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    return this.getCatalogue(page, '', 'populaire');
  }

  async getLatest(page = 1): Promise<SearchResult> {
    return this.getCatalogue(page, '', 'recents');
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    return this.getCatalogue(page, query, 'recents');
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl);
    const $ = this.$(res.data);
    const infos = new Map<string, string>();
    $('div.ori-sr-infos dt').each((_, dt) => {
      const $dt = $(dt);
      const dd = $dt.next('dd');
      const label = $dt.text().trim().toLowerCase();
      if (dd.length) infos.set(label, dd.text().trim());
    });
    let status: MangaStatus;
    switch (infos.get('statut')?.toLowerCase()) {
      case 'en cours':
        status = 1;
        break;
      case 'terminé':
        status = 0;
        break;
      case 'en pause':
        status = 2;
        break;
      case 'abandonné':
      case 'annulé':
        status = 2;
        break;
      default:
        status = undefined;
    }
    const description = $('div.ori-sr-syn-texte p')
      .toArray()
      .map(el => $(el).text().trim())
      .filter(Boolean)
      .join('\n');
    const altTitle = infos.get('nom alternatif')?.trim();
    const genre = [
      ...$('div.ori-sr-genres a.ori-sr-genre')
        .toArray()
        .map(el => $(el).text().trim()),
      ...(infos.get('type') ? [infos.get('type') as string] : []),
    ]
      .filter(Boolean)
      .join(', ');
    return {
      title: $('h1.ori-sr-title').first().text().trim(),
      url: mangaUrl,
      thumbnailUrl: $('div.ori-sr-cover img').first().attr('src') ?? '',
      author: infos.get('auteur') ?? infos.get('scénario'),
      artist: infos.get('artiste') ?? infos.get('dessin'),
      description: description || (altTitle ? `Nom alternatif: ${altTitle}` : undefined),
      genre: genre || undefined,
      status,
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = mangaSlug(mangaUrl);
    const url = `${this.baseUrl}/${MANGA_PATH}/${slug}/ajax/chapters/`;
    const res = await this.post(url, '', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const $ = this.$(res.data);
    const chapters: Chapter[] = [];
    $('div.ori-chl-row').each((_, el) => {
      const $el = $(el);
      const link = $el.find('a.ori-chl-corps').first();
      const href = link.attr('href') ?? '';
      const ts = $el.find('span.ori-chl-date').attr('data-ts');
      const dateText = $el.find('span.ori-chl-date').text().trim();
      let dateUpload: number | undefined;
      if (ts) {
        const parsed = parseInt(ts, 10);
        if (!isNaN(parsed)) dateUpload = parsed * 1000;
      }
      if (!dateUpload) dateUpload = parseChapterDate(dateText);
      const name =
        $el.find('span.ori-chl-nom-long').first().text().trim() ||
        link.text().trim() ||
        `Chapitre ${$el.attr('data-num') ?? ''}`;
      if (name && href) chapters.push({ name, url: href, dateUpload });
    });
    return chapters;
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl);
    const $ = this.$(res.data);
    return $('div.reading-content img.wp-manga-chapter-img')
      .toArray()
      .map((el, index) => ({
        index,
        imageUrl: ($(el).attr('src') ?? '').trim(),
      }))
      .filter(p => p.imageUrl);
  }
}
