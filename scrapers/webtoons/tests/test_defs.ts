import { listScrapers, getScraper } from '../src/runner';
import type { BaseScraper } from '../engine/base';

async function testScraper(name: string, scraper: BaseScraper) {
  const results: string[] = [];

  // 1) Test getSearch
  try {
    const search = await scraper.getSearch('One Piece', 1);
    const found = search.mangas.length;
    results.push(`search=${found}${search.hasNextPage ? '+' : ''}`);
  } catch (err: any) {
    results.push(`search=ERR:${err.message?.slice(0, 60) || err}`);
    return results;
  }

  // 2) Test getPopular
  try {
    const pop = await scraper.getPopular(1);
    results.push(`popular=${pop.mangas.length}${pop.hasNextPage ? '+' : ''}`);
  } catch {
    results.push('popular=SKIP');
  }

  // 3) Test getLatest
  try {
    const lat = await scraper.getLatest(1);
    results.push(`latest=${lat.mangas.length}${lat.hasNextPage ? '+' : ''}`);
  } catch {
    results.push('latest=SKIP');
  }

  // 4) If search found something, test getMangaDetails + getChapterList
  const search = await scraper.getSearch('One Piece', 1);
  const first = search.mangas[0];
  if (first) {
    try {
      const details = await scraper.getMangaDetails(first.url);
      results.push(`details=${details.title?.slice(0, 30) || 'OK'}`);
    } catch {
      results.push('details=ERR');
    }
    try {
      const chapters = await scraper.getChapterList(first.url);
      results.push(`chapters=${chapters.length}`);
    } catch {
      results.push('chapters=ERR');
    }
  } else {
    results.push('(no match)');
  }

  return results;
}

async function main() {
  const infos = listScrapers();
  console.log(`Testing ${infos.length} scrapers...\n`);

  const results: { name: string; status: string; details: string }[] = [];

  for (const info of infos) {
    const mod = await import(info.filePath);
    const Cls = mod[info.className] || mod.default;
    if (!Cls) {
      results.push({ name: info.name, status: 'NO_CLASS', details: '' });
      continue;
    }
    const scraper = new Cls() as BaseScraper;
    const start = Date.now();
    try {
      const res = await testScraper(info.name, scraper);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const err = res.find(r => r.startsWith('search=ERR:'));
      const status = err ? 'FAIL' : 'OK';
      results.push({ name: info.name, status, details: `${elapsed}s | ${res.join(', ')}` });
    } catch (err: any) {
      results.push({ name: info.name, status: 'CRASH', details: err.message?.slice(0, 80) || '' });
    }
  }

  // Summary
  const ok = results.filter(r => r.status === 'OK').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  const crash = results.filter(r => r.status === 'CRASH' || r.status === 'NO_CLASS').length;

  console.log('\n--- RESULTS ---');
  for (const r of results) {
    const icon = r.status === 'OK' ? 'OK' : r.status === 'FAIL' ? 'XX' : '!!';
    console.log(`[${icon}] ${r.name.padEnd(25)} ${r.details}`);
  }

  console.log(`\n=== Summary: ${ok} OK, ${fail} FAIL, ${crash} CRASH ===`);
}

main().catch(console.error);
