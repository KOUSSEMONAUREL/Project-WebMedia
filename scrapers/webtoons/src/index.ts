import { listScrapers, getScraper, getScraperForUrl } from './runner';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0]?.toLowerCase();

  switch (command) {
    case 'list':
    case 'ls': {
      const scrapers = listScrapers();
      const grouped: Record<string, typeof scrapers> = {};
      for (const s of scrapers) {
        (grouped[s.lang] ||= []).push(s);
      }
      for (const [lang, list] of Object.entries(grouped)) {
        console.log(`\n🌐 ${lang.toUpperCase()} (${list.length}):`);
        for (const s of list) {
          console.log(`  ${s.name.padEnd(30)} ${s.className}`);
        }
      }
      console.log(`\n📊 Total: ${scrapers.length} scrapers`);
      break;
    }

    case 'run': {
      const name = args[1];
      const url = args[2];
      if (!name) {
        console.error('Usage: npx tsx src/index.ts run <scraper-name> [url]');
        process.exit(1);
      }
      const scraper = await getScraper(name);
      if (!scraper) {
        console.error(`❌ Scraper "${name}" not found. Run "list" to see available scrapers.`);
        process.exit(1);
      }
      console.log(`🚀 Running ${scraper.name} (${scraper.baseUrl})...`);

      if (url) {
        const details = await scraper.getMangaDetails(url);
        console.log('📖 Manga Details:', JSON.stringify(details, null, 2));

        const chapters = await scraper.getChapterList(url);
        console.log(`📚 Chapters: ${chapters.length}`);
        if (chapters.length > 0) {
          const first = chapters[0];
          const pages = await scraper.getPageList(first.url);
          console.log(`🖼️  First chapter pages: ${pages.length}`);
        }
      } else {
        const popular = await scraper.getPopular(1);
        console.log(`🔥 Popular: ${popular.mangas.length} mangas`);
        if (popular.mangas.length > 0) {
          const first = popular.mangas[0];
          console.log(`   First: ${first.title} — ${first.url}`);
        }
      }
      break;
    }

    case 'url': {
      const targetUrl = args[1];
      if (!targetUrl) {
        console.error('Usage: npx tsx src/index.ts url <url>');
        process.exit(1);
      }
      const scraper = await getScraperForUrl(targetUrl);
      if (!scraper) {
        console.error(`❌ No scraper found for URL: ${targetUrl}`);
        process.exit(1);
      }
      console.log(`✅ Found: ${scraper.name} (${scraper.baseUrl})`);
      const chapters = await scraper.getChapterList(targetUrl);
      console.log(`📚 ${chapters.length} chapters`);
      console.log(JSON.stringify(chapters.slice(0, 5), null, 2));
      break;
    }

    default:
      console.log(`
Usage:
  npx tsx src/index.ts list                    List all scrapers
  npx tsx src/index.ts run <name> [url]        Run a scraper
  npx tsx src/index.ts url <url>               Find scraper by URL
`);
  }
}

main().catch(console.error);
