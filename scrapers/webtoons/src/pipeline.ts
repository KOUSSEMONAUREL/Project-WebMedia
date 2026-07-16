import { getScraper, getScraperForUrl } from './runner';
import { BaseScraper } from '../engine/base';

/**
 * Cible de scraping : un media existant dans Neon
 */
export interface MediaTarget {
  id: string;
  title: string;
  slug: string;
  type: string;
  externalId?: string;
  metadataSource?: string;
  synopsis?: string;
}

/**
 * Résultat de scraping pour un media
 */
export interface ScrapeResult {
  mediaId: string;
  source: string;
  rootUrl: string;
  chapters: { name: string; url: string; chapterNumber?: number }[];
  pages?: { url: string; index: number }[];
}

// Cache interne des scrapers
let _scrapers: { name: string; scraper: BaseScraper }[] | null = null;

async function loadScrapers(): Promise<{ name: string; scraper: BaseScraper }[]> {
  if (_scrapers) return _scrapers;
  const { listScrapers } = await import('./runner');
  const infos = listScrapers();
  const loaded: { name: string; scraper: BaseScraper }[] = [];
  for (const info of infos) {
    try {
      const mod = await import(info.filePath);
      const Cls = mod[info.className] || mod.default;
      if (Cls) loaded.push({ name: info.name, scraper: new Cls() });
    } catch (err) {
      console.error(`Failed to load scraper ${info.filePath}: ${err instanceof Error ? err.message : err}`);
    }
  }
  _scrapers = loaded;
  return loaded;
}

/**
 * Trouve tous les scrapers dont le baseUrl ou le nom matche le media.
 * D'abord par metadataSource, puis par recherche du titre.
 */
export async function findMatchingScrapers(media: MediaTarget): Promise<{ name: string; scraper: BaseScraper; url?: string }[]> {
  const all = await loadScrapers();
  const matches: { name: string; scraper: BaseScraper; url?: string }[] = [];

  // 1. Si metadataSource est renseigné, chercher un scraper dont le nom correspond
  if (media.metadataSource) {
    const sourceLower = media.metadataSource.toLowerCase();
    const candidates = all.filter(
      ({ name, scraper }) => name.toLowerCase().includes(sourceLower) || scraper.baseUrl.toLowerCase().includes(sourceLower)
    );
    const metaResults = await Promise.allSettled(
      candidates.map(async ({ name, scraper }) => {
        const search = await scraper.getSearch(media.title, 1);
        const found = search.mangas.find(m => m.title.toLowerCase().includes(media.title.toLowerCase()));
        if (found) return { name, scraper, url: found.url };
        return null;
      })
    );
    for (const r of metaResults) {
      if (r.status === 'fulfilled' && r.value) matches.push(r.value);
      else if (r.status === 'rejected')
        console.error(`Search failed: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
    }
  }

  // 2. Chercher par titre dans TOUS les scrapers en parallele
  type SearchOutcome = { name: string; error: string } | undefined;
  const searchOutcomes = (await Promise.allSettled(
    all.map(async ({ name, scraper }): Promise<SearchOutcome> => {
      try {
        const search = await scraper.getSearch(media.title, 1);
        const found = search.mangas.find(m => m.title.toLowerCase().includes(media.title.toLowerCase()));
        if (found && !matches.some(m => m.name === name)) {
          matches.push({ name, scraper, url: found.url });
        }
      } catch (err) {
        return { name, error: err instanceof Error ? err.message : String(err) };
      }
    })
  )) as PromiseSettledResult<SearchOutcome>[];

  for (const outcome of searchOutcomes) {
    if (outcome.status === 'fulfilled' && outcome.value) {
      console.error(`Search failed for scraper ${outcome.value.name} with title "${media.title}": ${outcome.value.error}`);
    }
  }

  return matches;
}

/**
 * Scrape un media : chapitres + pages pour chaque source trouvée.
 * Retourne tous les résultats, dédupliqués par URL de chapitre.
 */
export async function scrapeMedia(media: MediaTarget): Promise<ScrapeResult[]> {
  const matches = await findMatchingScrapers(media);
  const results: ScrapeResult[] = [];
  const seenUrls = new Set<string>();

  for (const { name, scraper, url } of matches) {
    if (!url) continue;
    try {
      const chapters = await scraper.getChapterList(url);
      const unique = chapters.filter(c => {
        if (seenUrls.has(c.url)) return false;
        seenUrls.add(c.url);
        return true;
      });

      // Optionnel : pages pour le premier chapitre
      let pages: { url: string; index: number }[] | undefined;
      if (unique.length > 0) {
        try {
          const pageList = await scraper.getPageList(unique[0].url);
          pages = pageList.map(p => ({ url: p.imageUrl, index: p.index }));
        } catch (err) {
          console.error(`Failed to get page list for ${unique[0]?.url}: ${err instanceof Error ? err.message : err}`);
        }
      }

      results.push({
        mediaId: media.id,
        source: name,
        rootUrl: url,
        chapters: unique,
        pages,
      });
    } catch (err) {
      console.error(`Failed to scrape media ${name}: ${err instanceof Error ? err.message : err}`);
    }
  }

  return results;
}
