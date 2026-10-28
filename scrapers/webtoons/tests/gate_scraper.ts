import { listScrapers, ScraperInfo } from '../src/runner';
import { probeOrigin } from './origin_diagnose';
import type { BaseScraper } from '../engine/base';
import type { Manga, SearchResult } from '../engine/types';

const CALL_TIMEOUT_MS = 15_000;

type StageResult<T> = {
  value?: T;
  error?: string;
  unsupported?: boolean;
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), ms),
    ),
  ]);
}

async function attempt<T>(
  fn: () => Promise<T>,
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<StageResult<T>> {
  try {
    return { value: await withTimeout(fn(), timeoutMs) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      error: message.slice(0, 200),
      unsupported: /not implemented/i.test(message),
    };
  }
}

function findScraper(arg: string): ScraperInfo | undefined {
  const normalized = arg.replace(/\\/g, '/');
  const scrapers = listScrapers();
  return (
    scrapers.find((info) => info.filePath.replace(/\\/g, '/').endsWith(normalized)) ||
    scrapers.find((info) => info.filePath.replace(/\\/g, '/').includes(normalized))
  );
}

function countOf(result?: SearchResult): number {
  return result && Array.isArray(result.mangas) ? result.mangas.length : 0;
}

function firstManga(result?: SearchResult): Manga | undefined {
  return result?.mangas?.find((manga) => Boolean(manga?.url));
}

function summarize(stage: StageResult<unknown>): string {
  if (stage.error) return stage.error;
  return 'ok';
}

async function main(): Promise<void> {
  const arg = process.argv.slice(2).find((value) => !value.startsWith('-'));

  if (!arg) {
    console.log('GATE_JSON:' + JSON.stringify({
      status: 'ERROR',
      error: 'missing scraper path argument',
    }));
    return;
  }

  const info = findScraper(arg);
  if (!info) {
    console.log('GATE_JSON:' + JSON.stringify({
      status: 'ERROR',
      error: `scraper not found: ${arg}`,
    }));
    return;
  }

  let instance: BaseScraper;
  try {
    const mod = (await import(info.filePath)) as Record<string, unknown>;
    const ScraperClass = (mod[info.className] || mod.default) as
      | (new () => BaseScraper)
      | undefined;
    if (!ScraperClass) throw new Error(`class not found: ${info.className}`);
    instance = new ScraperClass();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log('GATE_JSON:' + JSON.stringify({
      status: 'ERROR',
      name: info.name,
      className: info.className,
      filePath: info.filePath,
      error: `instantiate failed: ${message.slice(0, 200)}`,
    }));
    return;
  }

  const popular = await attempt(() => instance.getPopular(1));
  const latest = await attempt(() => instance.getLatest(1));
  const popularCount = countOf(popular.value);
  const latestCount = countOf(latest.value);
  const homeSupported = !popular.unsupported || !latest.unsupported;
  const homeCount = homeSupported ? Math.max(popularCount, latestCount) : null;
  const homeManga = firstManga(popular.value) || firstManga(latest.value);

  const query = (homeManga?.title || instance.name || 'manga').slice(0, 40);
  const search = await attempt(() => instance.getSearch(query, 1));
  const searchCount = countOf(search.value);
  const searchManga = firstManga(search.value);
  const manga = homeManga || searchManga;

  const chapters = manga
    ? await attempt(() => instance.getChapterList(manga.url))
    : { error: 'no manga url', value: [] as Awaited<ReturnType<BaseScraper['getChapterList']>> };
  const chapterCount = Array.isArray(chapters.value) ? chapters.value.length : 0;
  const chapter = chapters.value?.find((item) => Boolean(item?.url));

  const pages = chapter
    ? await attempt(() => instance.getPageList(chapter.url))
    : { error: 'no chapter url', value: [] as Awaited<ReturnType<BaseScraper['getPageList']>> };
  const pageCount = Array.isArray(pages.value) ? pages.value.length : 0;
  const pagesUnsupported = Boolean(pages.unsupported);

  let status = 'OK';
  let error = '';

  if (homeCount === 0) {
    status = 'EMPTY';
    error = 'popular and latest returned zero manga';
  } else if (searchCount === 0) {
    status = 'SEARCH_EMPTY';
    error = `search returned zero manga for ${JSON.stringify(query)}`;
  } else if (chapterCount === 0) {
    status = 'CHAPTERS_EMPTY';
    error = chapters.error || 'chapter list is empty';
  } else if (pageCount === 0 && !pagesUnsupported) {
    status = 'PAGES_EMPTY';
    error = pages.error || 'page list is empty';
  } else if (homeCount === null && searchCount > 0 && chapterCount > 0 && (pageCount > 0 || pagesUnsupported)) {
    status = 'OK';
    error = 'popular/latest not implemented; search and content stages pass';
  }

  const networkError = [popular, latest, search, chapters, pages]
    .map((stage) => stage.error || '')
    .find((message) => /TIMEOUT|ECONN|ENOTFOUND|EAI_AGAIN|socket hang up|Network Error/i.test(message));

  const stageStatus = status;
  if (status !== 'OK') {
    const probe = await probeOrigin(instance.baseUrl);
    if (probe.verdict === 'DEAD') status = 'DEAD';
    else if (probe.verdict === 'BLOCKED') status = 'BLOCKED';
    else if (networkError) status = 'NETWORK';

    console.log('GATE_JSON:' + JSON.stringify({
      status,
      stageStatus,
      name: instance.name || info.name,
      className: info.className,
      filePath: info.filePath,
      baseUrl: instance.baseUrl,
      query,
      popular: { count: popularCount, error: summarize(popular), unsupported: Boolean(popular.unsupported) },
      latest: { count: latestCount, error: summarize(latest), unsupported: Boolean(latest.unsupported) },
      search: { count: searchCount, error: summarize(search) },
      chapters: { count: chapterCount, mangaUrl: manga?.url || null, error: summarize(chapters) },
      pages: { count: pageCount, unsupported: pagesUnsupported, chapterUrl: chapter?.url || null, error: summarize(pages) },
      probe: { verdict: probe.verdict, detail: probe.detail },
      error: error || networkError || probe.detail,
    }));
    return;
  }

  console.log('GATE_JSON:' + JSON.stringify({
    status,
    stageStatus,
    name: instance.name || info.name,
    className: info.className,
    filePath: info.filePath,
    baseUrl: instance.baseUrl,
    query,
    popular: { count: popularCount, error: summarize(popular), unsupported: Boolean(popular.unsupported) },
    latest: { count: latestCount, error: summarize(latest), unsupported: Boolean(latest.unsupported) },
    search: { count: searchCount, error: summarize(search) },
    chapters: { count: chapterCount, mangaUrl: manga?.url || null, error: summarize(chapters) },
    pages: { count: pageCount, unsupported: pagesUnsupported, chapterUrl: chapter?.url || null, error: summarize(pages) },
    probe: null,
    error,
  }));
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.log('GATE_JSON:' + JSON.stringify({
    status: 'ERROR',
    error: `fatal: ${message.slice(0, 200)}`,
  }));
});
