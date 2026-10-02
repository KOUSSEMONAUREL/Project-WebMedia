import { BaseScraper } from '../../../engine/base';
import type { Manga, Chapter, Page, SearchResult } from '../../../engine/types';

/**
 * Transcompilation de keiyoushi `en/pornhwa18` (Pornhwa18.kt).
 *
 * Le site est build avec Qwik City : chaque page possède un `q-data.json`
 * dont les valeurs sont des références base 36 dans le tableau `_objs`
 * (route loader data). `qwikLoader` résout ces références de manière
 * récursive puis renvoie la première valeur non nulle du loader actif.
 *
 * Divergences volontaires par rapport à l'extension Kt originale :
 * - Le moteur TS n'a pas de « memo » (JsonObject de métadonnées par
 *   manga/chapitre) : le slug de série, conservé en memo dans le Kt, est
 *   encodé dans l'URL des objets renvoyés (`/comic/<slug>/` et
 *   `/comic/<slug>/chapter-<n>/`), qui correspond de toute façon au chemin
 *   réel de la page. `getMangaByUrl` (entrée par URL hors conteneur) est
 *   retiré ; le slug est relu de l'URL dans details/chapters.
 * - `date_upload = 0` quand `createdAt` est absent/null devient `undefined`.
 *
 * Limite externe connue : les toutes premieres archives publient des URL
 * d'image que le site lui-meme pointe vers des ressources disparues. Le
 * chapitre 1 sert ainsi `.../cdn.manhwature.com/cdn.manhwa18.com/f/files/2021-11-01/...`
 * (prefixe d'hote double), recopie verbatim depuis le `data-src` de la page, et
 * qui repond 404. Les chapitres recents (1, 161, 319 sur 326) repondent 206.
 * Le port restitue donc fidelement l'etat du site : les images de ces
 * quelques chapitres anciens resteront indisponibles, independamment du port.
 */

const PAGE_SIZE = 18;
const UNDEFINED = '\u0001';

type Json = null | boolean | number | string | Json[] | JsonObject;
interface JsonObject {
  [key: string]: Json;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class Pornhwa18Scraper extends BaseScraper {
  readonly name = 'Pornhwa';
  readonly baseUrl = 'https://www.pornhwa18.com';
  readonly lang = 'en';

  /** Résout le route-loader Qwik (équivalent de Response.qwikLoader()) */
  private qwikLoader(root: unknown): unknown {
    if (!isJsonObject(root)) {
      throw new Error(`${this.name}: unexpected q-data payload`);
    }
    const objs = root['_objs'];
    const entry = root['_entry'];
    const objsArray: Json[] = Array.isArray(objs) ? (objs as Json[]) : [];

    const refIndex = (ref: Json): number => {
      if (typeof ref !== 'string') return -1;
      const n = Number.parseInt(ref, 36);
      return Number.isNaN(n) ? -1 : n;
    };

    const resolve = (ref: Json): Json => {
      const stored = objsArray[refIndex(ref)];
      const value = stored !== undefined ? stored : ref;
      if (Array.isArray(value)) {
        return value.map((item) => resolve(item as Json));
      }
      if (isJsonObject(value)) {
        const out: JsonObject = {};
        for (const key of Object.keys(value)) {
          out[key] = resolve(value[key]);
        }
        return out;
      }
      if (value === null || typeof value !== 'string') return value;
      if (value === UNDEFINED) return null;
      if (value.length > 0 && value.charCodeAt(0) < 0x20) {
        return value.substring(1);
      }
      return value;
    };

    const resolvedEntry = resolve(entry as Json);
    if (!isJsonObject(resolvedEntry)) {
      throw new Error(`${this.name}: cannot resolve q-data entry`);
    }
    const loaders = resolvedEntry['loaders'];
    if (!isJsonObject(loaders)) {
      throw new Error(`${this.name}: cannot resolve q-data loaders`);
    }
    const active = Object.values(loaders).find((value) => value !== null);
    if (active === undefined) {
      throw new Error(`${this.name}: no active loader`);
    }
    return active;
  }

  private toManga(item: unknown): Manga {
    if (!isJsonObject(item)) {
      throw new Error(`${this.name}: malformed series`);
    }
    const title = item['title'];
    const slug = item['slug'];
    const poster = item['poster'];
    if (typeof title !== 'string' || typeof slug !== 'string') {
      throw new Error(`${this.name}: malformed series (title/slug)`);
    }
    return {
      url: `/comic/${slug}/`,
      title,
      thumbnailUrl: typeof poster === 'string'
        ? poster.replace('/188.165.221.196/', '/manhwa18.com/')
        : '',
      lang: this.lang,
    };
  }

  private async listing(path: string, page: number): Promise<SearchResult> {
    const url = `${this.baseUrl}${path}q-data.json`;
    const target = `${url}${page > 1 ? `?page=${page}` : ''}`;
    const res = await this.get(target);
    const resolved = this.qwikLoader(res.data);
    if (!Array.isArray(resolved)) {
      throw new Error(`${this.name}: listing is not an array`);
    }
    const dropped = resolved.slice((page - 1) * PAGE_SIZE);
    const mangas = dropped
      .filter((item) => isJsonObject(item) && typeof item['slug'] === 'string' && (item['slug'] as string).trim().length > 0)
      .map((item) => this.toManga(item));
    return { mangas, hasNextPage: resolved.length >= page * PAGE_SIZE };
  }

  async getPopular(page: number = 1): Promise<SearchResult> {
    return this.listing('/popular/', page);
  }

  async getLatest(page: number = 1): Promise<SearchResult> {
    return this.listing('/', page);
  }

  async getSearch(query: string, page: number = 1): Promise<SearchResult> {
    return this.listing(`/search/${encodeURIComponent(query.trim())}/`, page);
  }

  private slugFromUrl(mangaUrl: string): string {
    const segments = mangaUrl.split('/').filter((segment) => segment.length > 0);
    const index = segments.indexOf('comic');
    if (index >= 0 && segments[index + 1]) return decodeURIComponent(segments[index + 1] as string);
    return mangaUrl.replace(/^\/+|\/+$/g, '');
  }

  private fetchSeries(slug: string): Promise<unknown> {
    return this.get(`${this.baseUrl}/comic/${slug}/q-data.json`).then((res) =>
      this.qwikLoader(res.data),
    );
  }

  private toMangaDetails(item: unknown): Partial<Manga> {
    if (!isJsonObject(item)) return {};
    const taxRaw = item['taxonomy_relation'];
    const taxonomies = Array.isArray(taxRaw)
      ? taxRaw
          .map((rel) => (isJsonObject(rel) ? rel['taxonomy'] : undefined))
          .filter((tax): tax is JsonObject => isJsonObject(tax))
      : [];

    const nameOf = (type: string): string[] =>
      taxonomies
        .filter((tax) => tax['type'] === type && typeof tax['name'] === 'string')
        .map((tax) => tax as { name: string })
        .map((tax) => tax.name);

    const author = nameOf('author').join(', ');
    const artist = nameOf('artist').join(', ');
    const type = typeof item['type'] === 'string' ? (item['type'] as string) : undefined;
    const genre = [type, ...nameOf('genre')].filter((v): v is string => Boolean(v)).join(', ');

    const synopsis = typeof item['synopsis'] === 'string' ? (item['synopsis'] as string).trim() : '';
    const alter = typeof item['alter'] === 'string' ? (item['alter'] as string).trim() : '';
    const description = [
      synopsis.length > 0 ? synopsis : '',
      alter.length > 0 ? `Alternative titles: ${alter}` : '',
    ]
      .filter((part) => part.length > 0)
      .join('\n\n');

    const statusStr = typeof item['status'] === 'string' ? (item['status'] as string) : '';
    const status = statusStr === 'on-going' ? 1 : statusStr === 'end' ? 0 : statusStr === 'on-hold' ? 3 : 3;

    return {
      author: author || undefined,
      artist: artist || undefined,
      genre: genre || undefined,
      description: description || undefined,
      status,
      lang: this.lang,
    };
  }

  async getMangaDetails(mangaUrl: string): Promise<Partial<Manga>> {
    const series = await this.fetchSeries(this.slugFromUrl(mangaUrl));
    const details = this.toMangaDetails(series);
    if (isJsonObject(series)) {
      const title = series['title'];
      if (typeof title === 'string') details.title = title;
      const slug = series['slug'];
      if (typeof slug === 'string') details.url = `/comic/${slug}/`;
      const poster = series['poster'];
      if (typeof poster === 'string') {
        details.thumbnailUrl = poster.replace('/188.165.221.196/', '/manhwa18.com/');
      }
    }
    return details;
  }

  private toChapter(item: unknown, slug: string): Chapter {
    if (!isJsonObject(item)) {
      throw new Error(`${this.name}: malformed chapter`);
    }
    const chapter = item['chapter'];
    const createdAt = item['created_at'];
    if (typeof chapter !== 'number' && typeof chapter !== 'string') {
      throw new Error(`${this.name}: malformed chapter (number)`);
    }
    const number = chapter.toString().replace(/\.0$/, '');
    const chapterOut: Chapter = {
      name: `Chapter ${number}`,
      url: `/comic/${slug}/chapter-${number}/`,
      chapterNumber: typeof chapter === 'number' ? chapter : Number.parseFloat(chapter),
    };
    if (typeof createdAt === 'string') {
      const ms = Date.parse(createdAt);
      if (!Number.isNaN(ms)) chapterOut.dateUpload = ms;
    }
    return chapterOut;
  }

  async getChapterList(mangaUrl: string): Promise<Chapter[]> {
    const slug = this.slugFromUrl(mangaUrl);
    const series = await this.fetchSeries(slug);
    if (!isJsonObject(series)) return [];
    const chaptersRaw = series['chapters'];
    if (!Array.isArray(chaptersRaw)) return [];
    return chaptersRaw.map((item) => this.toChapter(item, slug));
  }

  async getPageList(chapterUrl: string): Promise<Page[]> {
    const res = await this.get(`${this.absUrl(chapterUrl)}q-data.json`);
    const resolved = this.qwikLoader(res.data);
    if (!isJsonObject(resolved)) {
      throw new Error(`${this.name}: reader payload is not an object`);
    }
    const data = resolved['data'];
    if (!isJsonObject(data)) {
      throw new Error(`${this.name}: reader data missing`);
    }
    const chapters = data['chapters'];
    if (!Array.isArray(chapters) || !isJsonObject(chapters[0])) {
      throw new Error(`${this.name}: reader chapters missing`);
    }
    const images = chapters[0]['images'];
    if (!isJsonObject(images)) {
      throw new Error(`${this.name}: reader images missing`);
    }
    const entries = Object.entries(images)
      .sort(([a], [b]) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
    const pages: Page[] = [];
    for (const [index, image] of entries) {
      if (isJsonObject(image)) {
        const src = (image as JsonObject)['src'];
        if (typeof src === 'string') {
          pages.push({ index: pages.length, imageUrl: src });
        }
      }
    }
    return pages;
  }
}