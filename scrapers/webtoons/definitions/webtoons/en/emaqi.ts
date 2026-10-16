import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const SERIES_QUERY = `query FetchHomeSection($slug: String!, $mangaAfter: String) {
  homeSection(slug: $slug) {
    mangaConn(first: 40, after: $mangaAfter) {
      edges {
        node {
          comic {
            comicId
            slug
            title
            cover { url }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const SEARCH_QUERY = `query Search($input: SearchInput!) {
  search(input: $input) {
    comicId
    slug
    title
    cover { url }
  }
}`;

export class EmaqiScraper extends BaseScraper {
  readonly name = 'emaqi';
  readonly baseUrl = 'https://emaqi.com';
  readonly lang = 'en';

  private async fetchSection(slug: string): Promise<SearchResult> {
    const res = await this.post('https://api.emaqi.com/graphql', {
      query: SERIES_QUERY,
      operationName: 'FetchHomeSection',
      variables: { slug, mangaAfter: null },
    });
    const data: any = res.data;
    const edges: any[] = data?.data?.homeSection?.mangaConn?.edges ?? [];
    const mangas: Manga[] = edges.map((e: any) => ({
      title: e?.node?.comic?.title ?? '',
      url: this.absUrl(`/manga/${e?.node?.comic?.slug ?? ''}`),
      thumbnailUrl: e?.node?.comic?.cover?.url ?? '',
      lang: this.lang,
    })).filter(m => m.title);
    const hasNextPage = data?.data?.homeSection?.mangaConn?.pageInfo?.hasNextPage === true;
    return { mangas, hasNextPage };
  }

  async getPopular(_page = 1): Promise<SearchResult> {
    return this.fetchSection('this-week-s-bestsellers');
  }

  async getLatest(_page = 1): Promise<SearchResult> {
    return this.fetchSection('hot-release');
  }

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const res = await this.post('https://api.emaqi.com/graphql', {
      query: SEARCH_QUERY,
      operationName: 'Search',
      variables: { input: { keyword: query, tagSlugGroups: [], page: _page, limit: 20 } },
    });
    const data: any = res.data;
    const items: any[] = data?.data?.search ?? [];
    const mangas: Manga[] = items.map((it: any) => ({
      title: it?.title ?? '',
      url: this.absUrl(`/manga/${it?.slug ?? ''}`),
      thumbnailUrl: it?.cover?.url ?? '',
      lang: this.lang,
    })).filter(m => m.title);
    return { mangas, hasNextPage: mangas.length === 20 };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    return { url: mangaUrl, lang: this.lang };
  }

  async getChapterList(_mangaUrl: string): Promise<Chapter[]> {
    return [];
  }

  async getPageList(_chapterUrl: string): Promise<Page[]> {
    return [];
  }
}
