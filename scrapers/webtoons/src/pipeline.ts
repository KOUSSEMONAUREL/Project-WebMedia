import { getScraper, getScraperForUrl } from './runner';
import { BaseScraper } from '../engine/base';
import { isSameTitle } from './title-match';

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
 * Resultat de scraping pour un media
 *
 * `sourcesMatched` compte les sources retenues par le matching, avant tout
 * grattage. C'est ce nombre qui distingue "le titre n'existe sur aucune source"
 * de "la source a ete trouvee mais n'a pas rendu de chapitre" : sans lui, un
 * titre absent et une source en panne finissent tous deux en no_match, et le
 * catalogue perdrait des medias qui existent.
 */
export interface ScrapeResult {
  mediaId: string;
  source: string;
  rootUrl: string;
  chapters: { name: string; url: string; chapterNumber?: number }[];
  pages?: { url: string; index: number }[];
}

/** Sortie de scrapeMedia : ce qu'on a reussi a extraire, et sur combien de sources. */
export interface ScrapeOutcome {
  results: ScrapeResult[];
  /** Sources trouvees pour ce titre, independamment du nombre de chapitres. */
  sourcesMatched: number;
}

// Budget de recherche par titre. Les scrapers sont interroges en parallele :
// sans budget, le titre attend le plus lent, et plusieurs sources mortes
// imposent 30 s a chaque titre. Les requetes non terminees continuent en
// arriere-plan mais ne bloquent plus le worker.
const SEARCH_BUDGET_MS = 15_000;

// Cache interne des scrapers
let _scrapers: { name: string; scraper: BaseScraper }[] | null = null;

type ScraperEntry = { name: string; scraper: BaseScraper };
type ScraperMatch = { name: string; scraper: BaseScraper; url?: string };

/**
 * Interroge un groupe de scrapers en parallele, mais ne depasse pas le budget.
 * Les resultats arrives apres le budget sont ignores (le tableau `matches`
 * retourne ensuite est une copie, donc pas de mutation pendant le scraping).
 */
async function searchScrapers(
  entries: ScraperEntry[],
  title: string,
  matches: ScraperMatch[],
  budgetMs: number
): Promise<void> {
  if (entries.length === 0) return;

  const tasks = entries.map(async ({ name, scraper }) => {
    try {
      const search = await scraper.getSearch(title, 1);
      const found = search.mangas.find(m => isSameTitle(title, m.title));
      if (found && !matches.some(m => m.name === name)) {
        matches.push({ name, scraper, url: found.url });
      }
    } catch (err) {
      console.error(
        `Search failed for scraper ${name} with title "${title}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.allSettled(tasks).then(() => undefined),
      new Promise<void>(resolve => {
        timer = setTimeout(resolve, budgetMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
export async function findMatchingScrapers(media: MediaTarget): Promise<ScraperMatch[]> {
  const all = await loadScrapers();
  const matches: ScraperMatch[] = [];

  // 1. Si metadataSource est renseigné, chercher un scraper dont le nom correspond.
  //    On garde le budget : une source metadata morte ne doit pas ajouter 30 s.
  if (media.metadataSource) {
    const sourceLower = media.metadataSource.toLowerCase();
    const candidates = all.filter(
      ({ name, scraper }) => name.toLowerCase().includes(sourceLower) || scraper.baseUrl.toLowerCase().includes(sourceLower)
    );
    await searchScrapers(candidates, media.title, matches, SEARCH_BUDGET_MS);
  }

  // 2. Chercher par titre dans tous les scrapers. Chaque groupe est borne par
  //    le meme budget : une source morte ne bloque plus le titre.
  await searchScrapers(all, media.title, matches, SEARCH_BUDGET_MS);

  return [...matches];
}

/**
 * Scrape un media : chapitres + pages pour chaque source trouvée.
 * Retourne tous les résultats, dédupliqués par URL de chapitre, et le nombre
 * de sources retenues par le matching.
 */
export async function scrapeMedia(media: MediaTarget): Promise<ScrapeOutcome> {
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

  return { results, sourcesMatched: matches.length };
}
