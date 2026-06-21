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
    for (const { name, scraper } of all) {
      if (name.toLowerCase().includes(sourceLower) || scraper.baseUrl.toLowerCase().includes(sourceLower)) {
        // Trouver l'URL du manga via search
        try {
          const search = await scraper.getSearch(media.title, 1);
          const found = search.mangas.find(
            m => m.title.toLowerCase().includes(media.title.toLowerCase())
          );
          if (found) {
            matches.push({ name, scraper, url: found.url });
          }
        } catch (err) {
          console.error(`Search failed for scraper ${name} with title "${media.title}": ${err instanceof Error ? err.message : err}`);
        }
      }
    }
  }

  // 2. Chercher par titre dans TOUS les scrapers
  for (const { name, scraper } of all) {
    try {
      const search = await scraper.getSearch(media.title, 1);
      const found = search.mangas.find(
        m => m.title.toLowerCase().includes(media.title.toLowerCase())
      );
      if (found) {
        const exists = matches.some(m => m.name === name);
        if (!exists) {
          matches.push({ name, scraper, url: found.url });
        }
      }
    } catch (err) {
      console.error(`Search failed for scraper ${name} with title "${media.title}": ${err instanceof Error ? err.message : err}`);
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
        chapters: unique,
        pages,
      });
    } catch (err) {
      console.error(`Failed to scrape media ${name}: ${err instanceof Error ? err.message : err}`);
    }
  }

  return results;
}
