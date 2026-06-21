import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface Episode {
  episodeTitle: string;
  viewerLink: string;
  exposureDateMillis: number;
  hasBgm: boolean;
  chapterNumber?: number;
  seasonNumber?: number;
}

interface MotionToonAssets {
  images: Record<string, string>;
}

const EPISODE_NO_REGEX = /(?:(s(eason)?|saison|part|vol(ume)?)\s*\.?\s*(\d+).*?)?(.*?(mini|bonus|special).*?)?(e(p(isode)?)?|ch(apter)?)\s*\.?\s*(\d+(\.\d+)?)/i;
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export class WebtoonsScraper extends BaseScraper {
  readonly name = 'Webtoons.com';
  readonly baseUrl = 'https://www.webtoons.com';
  readonly lang = 'all';
  private readonly langCode = 'en';
  private readonly mobileUrl = 'https://m.webtoons.com';

  async getPopular(page = 1): Promise<SearchResult> {
    const ranking = ['trending', 'popular', 'originals', 'canvas'][page - 1] || 'trending';
    const res = await this.get(`/${this.langCode}/ranking/${ranking}`, {
      headers: { Referer: `${this.baseUrl}/` },
    });
    const $ = this.$(res.data);
    const mangas: Manga[] = [];
    $('.webtoon_list li a').each((_: any, el: any) => {
      mangas.push({
        url: $(el).attr('href') || '',
        title: $(el).find('.title').first().text().trim(),
        thumbnailUrl: $(el).find('img').first().attr('src') || '',
        lang: this.lang,
      });
    });
    return { mangas, hasNextPage: ranking !== 'canvas' };
  }

  async getLatest(_page = 1): Promise<SearchResult> {
    const day = DAY_NAMES[new Date().getDay()];
    const res = await this.get(`/${this.langCode}/originals/${day}?sortOrder=UPDATE`, {
      headers: { Referer: `${this.baseUrl}/` },
    });
    const $ = this.$(res.data);
    const mangas: Manga[] = [];
    $('.webtoon_list li a').each((_: any, el: any) => {
      mangas.push({
        url: $(el).attr('href') || '',
        title: $(el).find('.title').first().text().trim(),
        thumbnailUrl: $(el).find('img').first().attr('src') || '',
        lang: this.lang,
      });
    });
    return { mangas, hasNextPage: false };
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    if (query.startsWith('https://')) {
      const url = new URL(query);
      if (url.host !== new URL(this.baseUrl).host) throw new Error('Unsupported url');
      const titleNo = url.searchParams.get('title_no');
      if (!titleNo) throw new Error('Unsupported url');
      const path = url.pathname.split('/').filter(Boolean);
      if (path.length < 3) throw new Error('Unsupported url');
      const urlLang = path[0];
      const type = path[1];
      return this.getSearch(`id:${type}:${urlLang}:${titleNo}`, page);
    }

    if (query.startsWith('id:')) {
      const parts = query.split(':');
      if (parts.length < 4) return { mangas: [], hasNextPage: false };
      const [, type, lang, titleNo] = parts;
      if (lang !== this.langCode) return { mangas: [], hasNextPage: false };
      const tmpUrl = type === 'canvas' ? `/challenge/episodeList?titleNo=${titleNo}` : `/episodeList?titleNo=${titleNo}`;
      const details = await this.getMangaDetails(tmpUrl);
      return { mangas: [{
        url: tmpUrl,
        title: details.title || '',
        thumbnailUrl: details.thumbnailUrl || '',
        lang: this.lang,
        author: details.author,
        description: details.description,
      }], hasNextPage: false };
    }

    const res = await this.get(`/${this.langCode}/search?keyword=${encodeURIComponent(query)}${page > 1 ? '&page=' + page : ''}`, {
      headers: { Referer: `${this.baseUrl}/` },
    });
    const $ = this.$(res.data);
    const mangas: Manga[] = [];
    $('.webtoon_list li a').each((_: any, el: any) => {
      mangas.push({
        url: $(el).attr('href') || '',
        title: $(el).find('.title').first().text().trim(),
        thumbnailUrl: $(el).find('img').first().attr('src') || '',
        lang: this.lang,
      });
    });
    const hasNextPage = $('a.pagination[aria-current=true] + a').length > 0;
    return { mangas, hasNextPage };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const res = await this.get(mangaUrl, {
      headers: { Referer: `${this.baseUrl}/` },
    });
    const $ = this.$(res.data);
    return {
      url: res.request?.path || mangaUrl,
      title: $('h1.subj, h3.subj').first().text().trim(),
      author: $('.detail_header .info .author:nth-of-type(1)').first().text().trim() ||
              $('.detail_header .info .author_area').first().text().trim(),
      description: $('#_asideDetail p.summary').first().text().trim(),
      thumbnailUrl: $('head meta[property="og:image"]').attr('content') || '',
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const url = new URL(mangaUrl.startsWith('http') ? mangaUrl : `${this.baseUrl}${mangaUrl}`);
    const titleId = url.searchParams.get('title_no') || url.searchParams.get('titleNo');
    if (!titleId) throw new Error('Migrate from Webtoons.com to Webtoons.com');
    const path = url.pathname.split('/').filter(Boolean);
    const type = url.pathname.includes('episodeList')
      ? (path[0] === 'challenge' ? 'canvas' : 'webtoon')
      : (path[1] === 'canvas' ? 'canvas' : 'webtoon');

    const mobileRes = await this.get(
      `${this.mobileUrl}/api/v1/${type}/${titleId}/episodes?pageSize=99999`,
      { headers: { Referer: `${this.mobileUrl}/` } },
    );
    const body = mobileRes.data as { result?: { episodeList?: Episode[] } };
    const episodes = body?.result?.episodeList || [];

    const chapters: Chapter[] = [];
    let maxChapter = 0;
    let currentSeason = 1;
    let seasonOffset = 0;

    episodes.forEach((ep, idx) => {
      const match = ep.episodeTitle.match(EPISODE_NO_REGEX);
      const isSpecial = match?.[6] && !match[6].includes('mini') && !match[6].includes('bonus');
      let chapterNumber = -1;
      let seasonNumber = 1;

      if (match && !isSpecial) {
        chapterNumber = parseFloat(match[11] || '-1');
        seasonNumber = parseInt(match[4] || '1', 10);
      }

      if (chapterNumber === -1) {
        chapterNumber = idx + 1;
      } else {
        if (seasonNumber > currentSeason) {
          currentSeason = seasonNumber;
          if (chapterNumber <= maxChapter) seasonOffset = maxChapter;
        }
        chapterNumber = seasonOffset + chapterNumber;
        maxChapter = Math.max(maxChapter, chapterNumber);
      }

      chapters.push({
        name: `${ep.episodeTitle}${ep.hasBgm ? ' ♫' : ''}`,
        url: ep.viewerLink,
        chapterNumber,
        dateUpload: ep.exposureDateMillis,
      });
    });

    return chapters.reverse();
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(chapterUrl, {
      headers: { Referer: `${this.baseUrl}/` },
    });
    const $ = this.$(res.data);
    const pages: Page[] = [];
    $('#_imageList > img').each((i: number, el: any) => {
      let imgUrl = $(el).attr('data-url') || '';
      const urlObj = new URL(imgUrl);
      if (urlObj.searchParams.get('type') === 'q90') {
        urlObj.searchParams.delete('type');
        imgUrl = urlObj.toString();
      }
      pages.push({ index: i, imageUrl: imgUrl });
    });

    if (pages.length === 0) {
      const docString = $.html();
      const docUrlMatch = docString.match(/documentURL:.*?'(.*?)'/);
      const motionMatch = docString.match(/jpg:.*?'(.*?)\{/);
      if (docUrlMatch && motionMatch) {
        const motionRes = await this.get(docUrlMatch[1], {
          headers: { Referer: `${this.baseUrl}/` },
        });
        const motionData = motionRes.data as { assets?: MotionToonAssets };
        const images = motionData?.assets?.images || {};
        const sorted = Object.entries(images)
          .filter(([k]) => k.includes('layer'))
          .sort(([a], [b]) => a.localeCompare(b));
        sorted.forEach(([, v], i) => {
          pages.push({ index: i, imageUrl: motionMatch[1] + v });
        });
      }
    }

    return pages;
  }
}
