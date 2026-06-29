import http from 'http';

const port = parseInt(process.env.PORT || '8080', 10);
if (!process.env.GITHUB_ACTIONS) {
  const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', message: 'Master Import Worker Active' }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`[STARTUP] Master Worker Port ${port} Open.`);
  });
}

async function startApp() {
  console.log('[STARTUP] Initializing Engines...');
  try {
    const { default: cron } = await import('node-cron');
    const { importTMDB } = await import('./importers/tmdb.js');
    const { importAnime } = await import('./importers/anilist.js');
    const { importComics } = await import('./importers/comics.js');
    const { importPopularBooks } = await import('./importers/books.js');
    const { importGutenberg } = await import('./importers/gutenberg.js');
    const { importOpenLibrary } = await import('./importers/open-library.js');
    const { importPopularBooksFR } = await import('./importers/noslivres.js');
    const { importTrendingGames } = await import('./importers/igdb.js');
    const { importRoyalRoad } = await import('./importers/royalroad.js');
    const { importTrendingManga } = await import('./importers/mangadex.js');
    const { syncNeonToTurso } = await import('./sync-turso.js');
    const dotenv = await import('dotenv');

    dotenv.config();

    const tmdbKey = process.env.TMDB_API_KEY || '';
    const cvKey = process.env.COMICVINE_API_KEY || '';
    const gbKey = process.env.GOOGLE_BOOKS_API_KEY || '';
    const twitchId = process.env.TWITCH_CLIENT_ID || '';
    const twitchSecret = process.env.TWITCH_CLIENT_SECRET || '';

    const databaseUrl = process.env.NEON_DATABASE_URL || '';
    const tursoUrl = process.env.TURSO_DATABASE_URL || '';
    const tursoToken = process.env.TURSO_AUTH_TOKEN || '';

    const internalApiUrl = process.env.INTERNAL_API_URL || '';
    const internalApiKey = process.env.INTERNAL_API_KEY || '';

    const LIMIT = parseInt(process.env.IMPORT_LIMIT || '20', 10);

    console.log(`[STARTUP] Engines ready. Limit=${LIMIT}`);

    if (process.env.GITHUB_ACTIONS) {
      console.log('One-Shot mode (GitHub Actions)...');

      const run = async (label: string, fn: () => Promise<any>) => {
        try {
          console.log(`${label}...`);
          await fn();
        } catch (err: any) {
          console.error(`${label} ERROR: ${err.message}`);
        }
      };

      await run('TMDB', () => importTMDB(tmdbKey, databaseUrl, internalApiUrl, internalApiKey, LIMIT));
      await run('IGDB', () => importTrendingGames(twitchId, twitchSecret, databaseUrl, internalApiUrl, internalApiKey, LIMIT));
      await run('Books (Google)', () => importPopularBooks(gbKey, databaseUrl, internalApiUrl, internalApiKey, LIMIT));
      await run('Gutenberg', () => importGutenberg(databaseUrl, LIMIT));
      await run('OpenLibrary', () => importOpenLibrary(databaseUrl, 'popular', LIMIT));
      await run('NosLivres', () => importPopularBooksFR(databaseUrl, LIMIT));
      await run('Comics (ComicVine)', () => importComics(cvKey, databaseUrl, internalApiUrl, internalApiKey, LIMIT));
      await run('MangaDex', () => importTrendingManga(databaseUrl, '', LIMIT));
      await run('RoyalRoad', () => importRoyalRoad(databaseUrl, LIMIT));
      await run('AniList', () => importAnime(databaseUrl, LIMIT));
      await run('Sync Turso', () => syncNeonToTurso(databaseUrl, tursoUrl, tursoToken));

      console.log('One-Shot run completed.');
      process.exit(0);
    }
  } catch (err: any) {
    console.error('[STARTUP] Fatal error:', err.message || err);
    process.exit(1);
  }
}

setTimeout(startApp, 100);
