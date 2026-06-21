import http from 'http';

// 1. PORT IMMÉDIAT (Sauf sur GitHub Actions)
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
    console.log(`🚀 [STARTUP] Master Worker Port ${port} Open.`);
  });
}

// 2. CHARGEMENT ASYNCHRONE DES MOTEURS
async function startApp() {
  console.log('📦 [STARTUP] Initializing Elite Engines...');
  try {
    const { default: cron } = await import('node-cron');
    const { importTrending } = await import('./importers/tmdb.js');
    const { importAniList } = await import('./importers/anilist.js');
    const { importComics } = await import('./importers/comics.js');
    const { importPopularBooks } = await import('./importers/books.js');
    const { importGutenberg } = await import('./importers/gutendex.js');
    const { importOpenLibrary } = await import('./importers/open-library.js');
    const { importNosLivres } = await import('./importers/noslivres.js');
    const { importTrendingGames } = await import('./importers/igdb.js');
    const { importRoyalRoad } = await import('./importers/royalroad.js');
    const { syncNeonToTurso } = await import('./sync-turso.js');
    const { config } = await import('dotenv');

    config();

    // API Keys
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

    console.log('✅ [STARTUP] All Engines Operational. Setting up Automation...');

    // MODE GITHUB ACTIONS (One-shot)
    if (process.env.GITHUB_ACTIONS) {
      console.log('⚡ Running in One-Shot mode (GitHub Actions)...');

      // On lance les plus importants en priorité
      if (tmdbKey) {
        console.log('🎬 Importing Trending TMDB...');
        await importTrending(tmdbKey, databaseUrl, internalApiUrl, internalApiKey, 1);
      }

      console.log('🔄 Syncing Neon to Turso...');
      await syncNeonToTurso(databaseUrl, tursoUrl, tursoToken);

      // On peut aussi lancer IGDB s'il est configuré
      if (twitchId && twitchSecret) {
        console.log('🎮 Importing Games...');
        await importTrendingGames(twitchId, twitchSecret, databaseUrl, internalApiUrl, internalApiKey);
      }

      console.log('📖 Importing Books & Comics...');
      if (gbKey) await importPopularBooks(gbKey, databaseUrl, internalApiUrl, internalApiKey);
      await importGutenberg(databaseUrl);
      await importOpenLibrary(databaseUrl);
      await importNosLivres(databaseUrl);
      
      if (cvKey) await importComics(cvKey, databaseUrl, internalApiUrl, internalApiKey);

      console.log('📚 Importing RoyalRoad novels...');
      await importRoyalRoad(databaseUrl);

      console.log('⛩️ Importing Anime/Manga...');
      await importAniList(databaseUrl, 'ANIME', 'TV', internalApiUrl, internalApiKey, 1);

      console.log('✅ One-Shot run completed.');
      process.exit(0);
    }
    
  } catch (err) {
    console.error('💥 [STARTUP] Fatal error during initialization:', err);
  }
}

setTimeout(startApp, 100);