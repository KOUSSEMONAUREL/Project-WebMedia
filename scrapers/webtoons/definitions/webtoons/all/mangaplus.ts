import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const API_URL = 'https://jumpg-webapi.tokyo-cdn.com/api';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

interface MpTitle {
  titleId: number;
  name: string;
  author?: string;
  portraitImageUrl: string;
  viewCount?: number;
  language?: string;
}

interface MpChapter {
  titleId: number;
  chapterId: number;
  name: string;
  subTitle?: string;
  startTimeStamp: number;
  endTimeStamp: number;
  isVerticalOnly?: boolean;
}

interface MpPage {
  imageUrl: string;
  width: number;
  height: number;
  encryptionKey?: string;
}

interface MpMangaPage {
  mangaPage?: MpPage;
}

function langCode(lang: string): string {
  const map: Record<string, string> = {
    en: 'eng', es: 'esp', fr: 'fra', id: 'ind',
    'pt-BR': 'ptb', ru: 'rus', th: 'tha', vi: 'vie', de: 'deu',
  };
  return map[lang] || 'eng';
}

function langFilter(lang: string): string {
  const map: Record<string, string> = {
    en: 'ENGLISH', es: 'SPANISH', fr: 'FRENCH', id: 'INDONESIAN',
    'pt-BR': 'PORTUGUESE_BR', ru: 'RUSSIAN', th: 'THAI', vi: 'VIETNAMESE', de: 'GERMAN',
  };
  return map[lang] || 'ENGLISH';
}

export class MangaPlusScraper extends BaseScraper {
  readonly name = 'MANGA Plus';
  readonly baseUrl = 'https://mangaplus.shueisha.co.jp';
  readonly lang = 'all';

  private headers() {
    return {
      Origin: this.baseUrl,
      Referer: `${this.baseUrl}/`,
      'User-Agent': UA,
      'SESSION-TOKEN': crypto.randomUUID(),
    };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const res = await this.get(`${API_URL}/title_list/allV2?format=json`, {
      headers: this.headers(),
    });
    const data = res.data;
    const groups = data?.success?.allTitlesViewV2?.AllTitlesGroup || [];
    const allTitles: MpTitle[] = groups.flatMap((g: any) => g.titles || []);

    const lf = langFilter(this.lang);
    const filtered = query
      ? allTitles.filter((t) => {
          const langOk = !t.language || t.language === lf;
          return langOk && t.name.toLowerCase().includes(query.toLowerCase());
        })
      : allTitles.filter((t) => !t.language || t.language === lf);

    const perPage = 20;
    const slice = filtered.slice((page - 1) * perPage, page * perPage);
    const mangas: Manga[] = slice.map((t) => ({
      title: t.name,
      url: `/titles/${t.titleId}`,
      thumbnailUrl: t.portraitImageUrl,
      lang: this.lang,
      author: t.author,
    }));

    return { mangas, hasNextPage: page * perPage < filtered.length };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const res = await this.get(
      `${API_URL}/title_list/rankingV2?lang=${langCode(this.lang)}&type=hottest&clang=${langCode(this.lang)}&format=json`,
      { headers: this.headers() },
    );
    const data = res.data;
    const rankedTitles = data?.success?.titleRankingViewV2?.rankedTitles || [];
    const allTitles: MpTitle[] = rankedTitles.flatMap((r: any) => r.titles || []);

    const lf = langFilter(this.lang);
    const filtered = allTitles.filter((t) => !t.language || t.language === lf);

    const perPage = 20;
    const slice = filtered.slice((page - 1) * perPage, page * perPage);
    const mangas: Manga[] = slice.map((t) => ({
      title: t.name,
      url: `/titles/${t.titleId}`,
      thumbnailUrl: t.portraitImageUrl,
      lang: this.lang,
      author: t.author,
    }));

    return { mangas, hasNextPage: page * perPage < filtered.length };
  }

  async getLatest(_page = 1): Promise<SearchResult> {
    const res = await this.get(
      `${API_URL}/home_v4?lang=${langCode(this.lang)}&clang=${langCode(this.lang)}&format=json`,
      { headers: this.headers() },
    );
    const data = res.data;
    const groups = data?.success?.homeViewV3?.groups || [];
    const allTitles: MpTitle[] = groups
      .flatMap((g: any) => g.titleGroups || [])
      .flatMap((tg: any) => tg.titles || [])
      .map((ut: any) => ut.title)
      .filter(Boolean);

    const lf = langFilter(this.lang);
    const seen = new Map<number, MpTitle>();
    for (const t of allTitles) {
      if (!t.language || t.language === lf) seen.set(t.titleId, t);
    }
    const filtered = Array.from(seen.values());

    const perPage = 20;
    const slice = filtered.slice(0, perPage);
    const mangas: Manga[] = slice.map((t) => ({
      title: t.name,
      url: `/titles/${t.titleId}`,
      thumbnailUrl: t.portraitImageUrl,
      lang: this.lang,
      author: t.author,
    }));

    return { mangas, hasNextPage: filtered.length > perPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const titleId = mangaUrl.split('/').pop();
    const res = await this.get(
      `${API_URL}/title_detailV3?title_id=${titleId}&format=json`,
      { headers: this.headers() },
    );
    const data = res.data;
    const view = data?.success?.titleDetailView;
    if (!view) return {};

    const t: MpTitle = view.title;
    return {
      title: t.name,
      thumbnailUrl: t.portraitImageUrl,
      author: t.author,
      artist: t.author,
      description: view.overview || '',
      status: 1,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const titleId = mangaUrl.split('/').pop();
    const res = await this.get(
      `${API_URL}/title_detailV3?title_id=${titleId}&format=json`,
      { headers: this.headers() },
    );
    const data = res.data;
    const view = data?.success?.titleDetailView;
    if (!view) return [];

    const groups: any[] = view.chapterListGroup || [];
    const chapters: MpChapter[] = groups.flatMap(
      (g: any) => [...(g.firstChapterList || []), ...(g.lastChapterList || [])],
    );

    const now = Math.floor(Date.now() / 1000);
    return chapters
      .filter((ch) => ch.subTitle != null && ch.endTimeStamp > now)
      .map((ch) => ({
        name: ch.subTitle ? `${ch.name} - ${ch.subTitle}` : ch.name,
        url: `/viewer/${ch.chapterId}`,
        chapterNumber: parseFloat(ch.name.replace('#', '')) || -1,
        scanlator: 'MANGA Plus',
        dateUpload: ch.startTimeStamp * 1000,
      }))
      .reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const chapterId = chapterUrl.split('/').pop();
    const res = await this.get(
      `${API_URL}/manga_viewer?chapter_id=${chapterId}&split=yes&img_quality=super_high&format=json`,
      { headers: this.headers() },
    );
    const data = res.data;
    const pages: MpMangaPage[] = data?.success?.mangaViewer?.pages || [];

    return pages
      .map((mp) => mp.mangaPage)
      .filter(Boolean)
      .map((p, i) => ({
        imageUrl: p!.encryptionKey ? `${p!.imageUrl}#${p!.encryptionKey}` : p!.imageUrl,
        index: i,
      }));
  }
}
