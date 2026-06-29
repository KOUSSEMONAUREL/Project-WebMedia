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

      if (tmdbKey) {
        console.log('TMDB...');
        await importTMDB(tmdbKey, databaseUrl, internalApiUrl, internalApiKey, LIMIT);
      }

      if (twitchId && twitchSecret) {
        console.log('IGDB...');
        await importTrendingGames(twitchId, twitchSecret, databaseUrl, internalApiUrl, internalApiKey, LIMIT);
      }

      console.log('Books & Comics...');
      if (gbKey) await importPopularBooks(gbKey, databaseUrl, internalApiUrl, internalApiKey, LIMIT);
      await importGutenberg(databaseUrl, LIMIT);
      await importOpenLibrary(databaseUrl, 'popular', LIMIT);
      await importPopularBooksFR(databaseUrl, LIMIT);
      if (cvKey) await importComics(cvKey, databaseUrl, internalApiUrl, internalApiKey, LIMIT);

      console.log('MangaDex...');
      await importTrendingManga(databaseUrl);

      console.log('RoyalRoad...');
      await importRoyalRoad(databaseUrl, LIMIT);

      console.log('AniList...');
      await importAnime(databaseUrl, LIMIT);

      console.log('Syncing Neon to Turso...');
      await syncNeonToTurso(databaseUrl, tursoUrl, tursoToken);

      console.log('One-Shot run completed.');
      process.exit(0);
    }
  } catch (err) {
    console.error('[STARTUP] Fatal error:', err);
  }
}

setTimeout(startApp, 100);
