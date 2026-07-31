import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

const API_URL = 'https://jumpg-webapi.tokyo-cdn.com/api';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ——— Décodeur protobuf minimal (wire format), autonome ———
// Le CLI mangaplus ne sert plus de JSON : l'API renvoie du protobuf binaire.
// On décode uniquement la structure nécessaire (varint / fixed64 / length-delimited / fixed32).

const LANG_NUM: Record<string, number> = {
  en: 0, es: 1, fr: 2, id: 3, 'pt-BR': 4, ru: 5, th: 6, de: 7, vi: 9,
};
const LANG_CODE: Record<string, string> = {
  en: 'eng', es: 'esp', fr: 'fra', id: 'ind', 'pt-BR': 'ptb', ru: 'rus', th: 'tha', de: 'deu', vi: 'vie',
};

class ProtoReader {
  private pos = 0;
  constructor(private buf: Buffer) {}

  varint(): number {
    let result = 0;
    let shift = 0;
    while (true) {
      if (this.pos >= this.buf.length) throw new Error('varint overflow');
      const byte = this.buf[this.pos++];
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result >>> 0;
      shift += 7;
      if (shift > 28) throw new Error('varint too long');
    }
  }

  fields(): { field: number; wire: number; value: Buffer | number }[] {
    const out: { field: number; wire: number; value: Buffer | number }[] = [];
    while (this.pos < this.buf.length) {
      const tag = this.varint();
      const field = tag >>> 3;
      const wire = tag & 0x7;
      if (field === 0) throw new Error('invalid field 0');
      if (wire === 0) out.push({ field, wire, value: this.varint() });
      else if (wire === 1) {
        out.push({ field, wire, value: this.buf.subarray(this.pos, this.pos + 8) });
        this.pos += 8;
      } else if (wire === 2) {
        const len = this.varint();
        const v = this.buf.subarray(this.pos, this.pos + len);
        this.pos += len;
        out.push({ field, wire, value: v });
      } else if (wire === 5) {
        out.push({ field, wire, value: this.buf.subarray(this.pos, this.pos + 4) });
        this.pos += 4;
      } else throw new Error(`unsupported wire type ${wire} on field ${field}`);
    }
    return out;
  }
}

function decodeMessage(buf: Buffer): Record<number, any> {
  const r = new ProtoReader(buf);
  const obj: Record<number, any> = {};
  for (const f of r.fields()) {
    const existing = obj[f.field];
    if (existing !== undefined) {
      obj[f.field] = Array.isArray(existing) ? [...existing, f.value] : [existing, f.value];
    } else {
      obj[f.field] = f.value;
    }
  }
  return obj;
}

function msgList(v: any): any[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v.filter(Boolean) : [v];
}

function str(v: any): string {
  if (v === undefined || v === null) return '';
  if (v instanceof Buffer) return v.toString('utf8');
  return String(v);
}

function num(v: any): number {
  if (v === undefined || v === null) return 0;
  if (typeof v === 'number') return v;
  if (v instanceof Buffer) return new ProtoReader(v).varint();
  return Number(v);
}

// ——— Décodage des messages métier ———

interface MpTitle {
  titleId: number;
  name: string;
  author: string;
  portraitImageUrl: string;
  language: number;
}

interface MpChapter {
  chapterId: number;
  name: string;
  subTitle: string;
  startTimeStamp: number;
}

function decodeTitle(buf: Buffer): MpTitle {
  const m = decodeMessage(buf);
  return {
    titleId: num(m[1]),
    name: str(m[2]),
    author: str(m[3]),
    portraitImageUrl: str(m[4]),
    language: num(m[7]),
  };
}

function decodeChapter(buf: Buffer): MpChapter {
  const m = decodeMessage(buf);
  return {
    chapterId: num(m[2]),
    name: str(m[3]),
    subTitle: str(m[4]),
    startTimeStamp: num(m[6]),
  };
}

function decodePage(buf: Buffer): { imageUrl: string; encryptionKey: string } {
  const m = decodeMessage(buf);
  return { imageUrl: str(m[1]), encryptionKey: str(m[5]) };
}

export class MangaPlusScraper extends BaseScraper {
  readonly name = 'MANGA Plus';
  readonly baseUrl = 'https://mangaplus.shueisha.co.jp';
  readonly lang = 'all';

  private session = crypto.randomUUID();

  private headers() {
    return {
      Origin: this.baseUrl,
      Referer: `${this.baseUrl}/`,
      'User-Agent': UA,
      'SESSION-TOKEN': this.session,
    };
  }

  /** Appelle l'API binaire, retourne le message SuccessResult décodé. */
  private async api(path: string, params: Record<string, string> = {}): Promise<Record<number, any>> {
    const qs = new URLSearchParams(params).toString();
    const url = `${API_URL}/${path}${qs ? `?${qs}` : ''}`;
    const res = await this.get(url, { responseType: 'arraybuffer', headers: this.headers() });
    const resp = decodeMessage(Buffer.from(res.data));
    if (resp[2]) {
      const err = decodeMessage(resp[2] as Buffer);
      throw new Error(`MANGA Plus API error: ${str(err[2])} (${str(err[1])})`);
    }
    if (!resp[1]) throw new Error('MANGA Plus API error: no success field');
    return decodeMessage(resp[1] as Buffer);
  }

  private toManga(t: MpTitle): Manga {
    return {
      title: t.name,
      url: `/titles/${t.titleId}`,
      thumbnailUrl: t.portraitImageUrl,
      lang: this.lang,
      author: t.author || undefined,
    };
  }

  private langCode(): string {
    return LANG_CODE[this.lang] || 'eng';
  }

  /** Langues acceptées : 'all' garde anglais + français, sinon la langue demandée. */
  private langNums(): number[] {
    if (this.lang === 'all') return [0, 2];
    const n = LANG_NUM[this.lang] ?? 0;
    return [n];
  }

  /** Déduplique par nom normalisé, en préférant l'anglais (lang 0) à l'existence d'un doublon. */
  private dedupe(titles: MpTitle[]): MpTitle[] {
    const byName = new Map<string, MpTitle>();
    for (const t of titles) {
      const key = t.name.toLowerCase();
      const existing = byName.get(key);
      if (!existing || (existing.language !== 0 && t.language === 0)) {
        byName.set(key, t);
      }
    }
    return Array.from(byName.values());
  }

  private async allTitles(): Promise<MpTitle[]> {
    const s = await this.api('title_list/allV2');
    const view = decodeMessage(s[25] as Buffer);
    return this.dedupe(
      msgList(view[1])
        .flatMap((g) => msgList(decodeMessage(g as Buffer)[2]))
        .map((t) => decodeTitle(t as Buffer))
        .filter((t) => t.titleId !== 0 && this.langNums().includes(t.language)),
    );
  }

  async getSearch(query: string, page = 1): Promise<SearchResult> {
    const all = await this.allTitles();
    const q = query.toLowerCase();
    const filtered = query
      ? all.filter((t) => t.name.toLowerCase().includes(q) || t.author.toLowerCase().includes(q))
      : all;

    const perPage = 20;
    const slice = filtered.slice((page - 1) * perPage, page * perPage);
    return { mangas: slice.map((t) => this.toManga(t)), hasNextPage: page * perPage < filtered.length };
  }

  async getPopular(page = 1): Promise<SearchResult> {
    const code = this.langCode();
    const s = await this.api('title_list/rankingV2', { lang: code, type: 'hottest', clang: code });
    const view = decodeMessage(s[37] as Buffer);
    const titles = this.dedupe(
      msgList(view[3])
        .map((r) => decodeMessage(r as Buffer)[2])
        .flatMap((t) => msgList(t))
        .map((t) => decodeTitle(t as Buffer))
        .filter((t) => t.titleId !== 0 && this.langNums().includes(t.language)),
    );

    const perPage = 20;
    const slice = titles.slice((page - 1) * perPage, page * perPage);
    return { mangas: slice.map((t) => this.toManga(t)), hasNextPage: page * perPage < titles.length };
  }

  async getLatest(_page = 1): Promise<SearchResult> {
    const code = this.langCode();
    const [homeS, allS] = await Promise.all([
      this.api('web/web_homeV4', { lang: code, clang: code }),
      this.api('title_list/allV2'),
    ]);

    const homeView = decodeMessage(homeS[38] as Buffer);
    const latestTitles = msgList(homeView[2])
      .flatMap((g) => msgList(decodeMessage(g as Buffer)[2]))
      .map((u) => {
        const v = decodeMessage(u as Buffer)[3];
        if (v === undefined || v === null) return null;
        const candidates = Array.isArray(v) ? v.filter(Boolean) : [v];
        for (const c of candidates) {
          const lc = decodeMessage(c as Buffer);
          if (lc[1]) return decodeTitle(lc[1] as Buffer);
        }
        return null;
      })
      .filter((t): t is MpTitle => t !== null);

    const allView = decodeMessage(allS[25] as Buffer);
    const allGroups = msgList(allView[1]).map((g) => msgList(decodeMessage(g as Buffer)[2]));

    const langNums = this.langNums();
    const seen = new Map<number, MpTitle>();
    for (const lt of latestTitles) {
      const group = allGroups.find((grp) => grp.some((t) => decodeTitle(t as Buffer).titleId === lt.titleId));
      if (!group) continue;
      const candidates = group.map((t) => decodeTitle(t as Buffer)).filter((t) => langNums.includes(t.language));
      const match = candidates.find((t) => t.language === 0) || candidates[0];
      if (match) seen.set(match.titleId, match);
    }

    const titles = Array.from(seen.values());
    const perPage = 20;
    const slice = titles.slice(0, perPage);
    return { mangas: slice.map((t) => this.toManga(t)), hasNextPage: titles.length > perPage };
  }

  private titleIdFromUrl(url: string): string {
    return url.split('/').pop() || '';
  }

  private async titleDetail(titleId: string) {
    const s = await this.api('title_detailV3', { title_id: titleId, clang: this.langCode() });
    return decodeMessage(s[8] as Buffer);
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const view = await this.titleDetail(this.titleIdFromUrl(mangaUrl));
    const t = view[1] ? decodeTitle(view[1] as Buffer) : null;
    if (!t) return {};

    const genres = msgList(view[31]).map((g) => str(decodeMessage(g as Buffer)[1])).filter(Boolean);
    return {
      title: t.name,
      thumbnailUrl: t.portraitImageUrl,
      author: t.author || undefined,
      artist: t.author || undefined,
      description: str(view[3]) || undefined,
      genre: genres.join(', ') || undefined,
      status: 1,
    };
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const view = await this.titleDetail(this.titleIdFromUrl(mangaUrl));
    const chapters: MpChapter[] = msgList(view[28]).flatMap((g) => {
      const gm = decodeMessage(g as Buffer);
      return [
        ...msgList(gm[2]).map((c) => decodeChapter(c as Buffer)),
        ...msgList(gm[4]).map((c) => decodeChapter(c as Buffer)),
      ];
    });

    return chapters
      .filter((ch) => ch.subTitle !== '')
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
    const chapterId = this.titleIdFromUrl(chapterUrl);
    const s = await this.api('manga_viewer_v3', {
      chapter_id: chapterId,
      split: 'yes',
      img_quality: 'super_high',
      clang: this.langCode(),
    });
    const viewer = decodeMessage(s[10] as Buffer);
    const viewToken = str(viewer[19]);

    return msgList(viewer[1])
      .map((mp) => decodeMessage(mp as Buffer)[1])
      .filter(Boolean)
      .map((p, i) => {
        const page = decodePage(p as Buffer);
        const tokenPart = viewToken ? `#${viewToken}` : '';
        return {
          imageUrl: page.encryptionKey ? `${page.imageUrl}#${page.encryptionKey}${tokenPart}` : `${page.imageUrl}${tokenPart}`,
          index: i,
        };
      });
  }
}
