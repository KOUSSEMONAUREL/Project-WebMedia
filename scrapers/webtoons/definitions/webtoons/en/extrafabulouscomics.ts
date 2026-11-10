import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

interface AppDto {
  instance: string;
}

interface AccessTokensDto {
  apps: Record<string, AppDto>;
}

interface PostDto {
  title: string;
  slug: string;
  firstPublishedDate: string;
}

interface PostsDto {
  posts: PostDto[];
  pagingMetadata: {
    total: number;
  };
}

interface ImageSrcDto {
  id: string;
}

interface ImageDto {
  src: ImageSrcDto;
}

interface ImageDataDto {
  image: ImageDto;
}

interface NodeDto {
  imageData?: ImageDataDto | null;
}

interface PostPageDto {
  postPage: {
    post: {
      richContent: {
        nodes: NodeDto[];
      };
    };
  };
}

const POSTS_PER_QUERY = 100;
const BLOG_APP_ID = '14bcded7-0066-7c35-14d7-466cb3f09103';
const MEDIA_URL = 'https://static.wixstatic.com/media';
const AUTHOR = 'Zach M. Stafford';
const DESCRIPTION = 'comics from hell and beyond, beyond hell, the field beyond hell where they ' +
  'grow corn and shit. Shit comics from the cornfield beyond hell';

export class ExtraFabulousComicsScraper extends BaseScraper {
  override readonly name = 'Extra Fabulous Comics';
  override readonly baseUrl = 'https://www.extrafabulouscomics.com';
  override readonly lang = 'en';

  async getPopular(_page = 1): Promise<SearchResult> {
    return { mangas: [this.createManga()], hasNextPage: false };
  }

  async getSearch(query: string, _page = 1): Promise<SearchResult> {
    const manga = this.createManga();
    const mangas = manga.title.toLowerCase().includes(query.trim().toLowerCase()) ? [manga] : [];
    return { mangas, hasNextPage: false };
  }

  private createManga(): Manga {
    return {
      url: this.absUrl('/archive'),
      title: this.name,
      author: AUTHOR,
      artist: AUTHOR,
      description: DESCRIPTION,
      thumbnailUrl: `${MEDIA_URL}/904535_d7187dcb8545431db8f80865f59ef376~mv2.png`,
      lang: this.lang,
    };
  }

  async getMangaDetails(_mangaUrl: string): Promise<Partial<Manga>> {
    return this.createManga();
  }

  async getChapterList(_mangaUrl: string): Promise<Chapter[]> {
    const headers = await this.apiHeaders();
    const first = await this.queryPosts(headers, 0);
    const offsets: number[] = [];
    for (let offset = first.posts.length; offset < first.pagingMetadata.total; offset += POSTS_PER_QUERY) {
      offsets.push(offset);
    }
    const others = await Promise.all(offsets.map(offset => this.queryPosts(headers, offset)));
    const posts = first.posts.concat(...others.map(result => result.posts));
    return posts.map((post, index) => {
      const date = Date.parse(post.firstPublishedDate);
      return {
        name: post.title,
        url: this.absUrl(`/${post.slug}`),
        chapterNumber: posts.length - index,
        dateUpload: Number.isNaN(date) ? undefined : date,
      };
    });
  }

  private async queryPosts(headers: Record<string, string>, offset: number): Promise<PostsDto> {
    const response = await this.post(
      `${this.baseUrl}/_api/communities-blog-node-api/v3/posts/query`,
      { query: { paging: { offset, limit: POSTS_PER_QUERY } } },
      { headers },
    );
    return response.data as PostsDto;
  }

  private async apiHeaders(): Promise<Record<string, string>> {
    const response = await this.get(`${this.baseUrl}/_api/v1/access-tokens`);
    const tokens = response.data as AccessTokensDto;
    const app = tokens.apps[BLOG_APP_ID];
    if (!app) throw new Error('ExtraFabulousComics: blog access token missing');
    return { Authorization: app.instance };
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const slug = new URL(this.absUrl(chapterUrl)).pathname.split('/').filter(Boolean).pop();
    if (!slug) throw new Error('ExtraFabulousComics: invalid chapter URL');
    const url = new URL(`${this.baseUrl}/_api/blog-frontend-adapter-public/v2/post-page/${slug}`);
    url.searchParams.set('languageCode', 'en');
    const response = await this.get(url.toString(), { headers: await this.apiHeaders() });
    const data = response.data as PostPageDto;
    return data.postPage.post.richContent.nodes
      .map(node => node.imageData?.image?.src?.id)
      .filter((id): id is string => Boolean(id))
      .map((id, index) => ({ index, imageUrl: `${MEDIA_URL}/${id}` }));
  }
}
