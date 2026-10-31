import { createDecipheriv } from 'crypto';
import { BaseScraper } from '../../../engine/base';
import type { Chapter, Manga, MangaStatus, Page, SearchResult } from '../../../engine/types';

interface Entry {
  series: string;
  timestamp: string;
  num: number;
  chname: string;
  AlbumID: string;
  projectname: string;
  projectdesc: string;
  projectaltname: string;
  projectauthor: string;
  projectartist: string;
  projectthumb: string;
  projectstatus: string;
  projecttags: string;
}

interface DriveResponse {
  files?: Array<{
    id: string;
    name: string;
    imageMediaMetadata?: { width?: number };
  }>;
}

interface ImgurResponse {
  data?: Array<{ link: string }>;
}

const KEY = Buffer.from('YX+1nM4KgfaYwNE3/MPcTg==', 'base64');
const IV = Buffer.from('279GjT2Xu9LZBkI4zLzIAg==', 'base64');
const IMGUR_CLIENT_ID = '227a2add62d2c9c';
const DRIVE_KEY = 'AIzaSyDDWjOHN1UPcafkwyJLO7fX1gmVyntIozs';
const CDN = 'https://wings.sbs/images/projcoverjpeg/';

function parseStatus(status: string): MangaStatus {
  switch (status) {
    case 'current': return 1;
    case 'complete': return 0;
    case 'dropped': return 2;
    case 'licensed': return 3;
    default: return undefined;
  }
}

function decrypt(albumId: string): string {
  const decipher = createDecipheriv('aes-128-cbc', KEY, IV);
  return Buffer.concat([
    decipher.update(Buffer.from(albumId, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export class SunshineButterflyScansScraper extends BaseScraper {
  readonly name = 'Sunshine Butterfly Scans';
  readonly baseUrl = 'https://wings.sbs';
  readonly lang = 'en';

  private groups?: Entry[][];

  async getPopular(): Promise<SearchResult> {
    const groups = await this.getGroups();
    const sorted = [...groups].sort((a, b) => a[0].series.localeCompare(b[0].series));
    return { mangas: sorted.map(group => this.toManga(group[0])), hasNextPage: false };
  }

  async getLatest(): Promise<SearchResult> {
    const groups = await this.getGroups();
    const sorted = [...groups].sort((a, b) => this.timestamp(b[0]) - this.timestamp(a[0]));
    return { mangas: sorted.map(group => this.toManga(group[0])), hasNextPage: false };
  }

  async getSearch(query: string): Promise<SearchResult> {
    const groups = await this.getGroups();
    const needle = query.trim().toLowerCase();
    const found = groups.filter(group => group[0].series.toLowerCase().includes(needle));
    return { mangas: found.map(group => this.toManga(group[0])), hasNextPage: false };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const project = this.projectName(mangaUrl);
    if (!project) return {};
    const groups = await this.getGroups();
    const entry = groups.find(group => group[0].projectname === project)?.[0];
    if (!entry) return {};
    return {
      title: entry.series,
      thumbnailUrl: entry.projectthumb ? `${CDN}${entry.projectthumb}` : undefined,
      description: entry.projectdesc + (entry.projectaltname ? `\n\nAlternative name: ${entry.projectaltname}` : ''),
      author: entry.projectauthor || undefined,
      artist: entry.projectartist || undefined,
      genre: entry.projecttags ? entry.projecttags.replace(/,/g, ', ') : undefined,
      status: parseStatus(entry.projectstatus),
      lang: this.lang,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const project = this.projectName(mangaUrl);
    if (!project) return [];
    const groups = await this.getGroups();
    const group = groups.find(items => items[0].projectname === project);
    if (!group) return [];
    return [...group]
      .sort((a, b) => b.num - a.num)
      .map(entry => ({
        name: entry.chname,
        url: `${this.baseUrl}/read?series=${encodeURIComponent(entry.projectname)}&num=${entry.num}`,
        chapterNumber: entry.num,
        dateUpload: entry.timestamp ? Number(entry.timestamp) * 1000 : undefined,
      }));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const url = new URL(chapterUrl, this.baseUrl);
    const project = url.searchParams.get('series');
    const num = Number(url.searchParams.get('num'));
    if (!project || !Number.isFinite(num)) return [];
    const groups = await this.getGroups();
    const entry = groups.flat().find(item => item.projectname === project && item.num === num);
    if (!entry?.AlbumID) return [];

    let decrypted: string;
    try {
      decrypted = decrypt(entry.AlbumID);
    } catch {
      return [];
    }
    if (decrypted.length > 10) {
      const query = `"${decrypted}"+in+parents`;
      const api = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&key=${DRIVE_KEY}&orderBy=name_natural&fields=files(id,name,imageMediaMetadata)&pageSize=250`;
      const res = await this.get(api);
      const data = res.data as DriveResponse;
      return (data.files ?? [])
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((file, index) => ({
          index,
          imageUrl: `https://lh3.googleusercontent.com/d/${file.id}=w${file.imageMediaMetadata?.width ?? 1000}`,
        }));
    }
    const res = await this.get(`https://api.imgur.com/3/album/${encodeURIComponent(decrypted)}/images`, {
      headers: { Authorization: `Client-ID ${IMGUR_CLIENT_ID}` },
    });
    const data = res.data as ImgurResponse;
    return (data.data ?? []).map((image, index) => ({ index, imageUrl: image.link }));
  }

  private async getGroups(): Promise<Entry[][]> {
    if (this.groups) return this.groups;
    const res = await this.get(`${this.baseUrl}/json/chapters.json`);
    const entries = Array.isArray(res.data) ? res.data as Entry[] : [];
    const grouped = new Map<string, Entry[]>();
    for (const entry of entries) {
      const list = grouped.get(entry.series);
      if (list) list.push(entry);
      else grouped.set(entry.series, [entry]);
    }
    this.groups = [...grouped.values()].map(group => group.sort((a, b) => b.num - a.num));
    return this.groups;
  }

  private toManga(entry: Entry): Manga {
    return {
      title: entry.series,
      url: `${this.baseUrl}/projects?n=${encodeURIComponent(entry.projectname)}`,
      thumbnailUrl: entry.projectthumb ? `${CDN}${entry.projectthumb}` : '',
      lang: this.lang,
    };
  }

  private timestamp(entry: Entry): number {
    return Number(entry.timestamp) || 0;
  }

  private projectName(url: string): string | undefined {
    try {
      return new URL(url, this.baseUrl).searchParams.get('n') ?? undefined;
    } catch {
      return undefined;
    }
  }
}
