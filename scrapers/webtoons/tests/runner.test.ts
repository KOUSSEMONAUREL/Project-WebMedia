import test from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';

test('scraper files exist', () => {
  const defsDir = path.join(__dirname, '..', 'definitions', 'webtoons');
  assert.ok(fs.existsSync(defsDir), 'definitions directory exists');

  const langs = fs.readdirSync(defsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
  assert.ok(langs.includes('en'), 'has en scrapers');
  assert.ok(langs.includes('fr'), 'has fr scrapers');
  assert.ok(langs.includes('all'), 'has all scrapers');
});

test('runner.listScrapers returns scrapers', async () => {
  const { listScrapers } = await import('../src/runner');
  const scrapers = listScrapers();
  assert.ok(scrapers.length >= 150, `Expected >=150, got ${scrapers.length}`);
  assert.ok(scrapers.some(s => s.name.toLowerCase().includes('mangadex')), 'MangaDex scraper found');
  assert.ok(scrapers.some(s => s.name.toLowerCase().includes('tcb')), 'TCB Scans scraper found');
});

test('runner.getScraper finds by name', async () => {
  const { getScraper } = await import('../src/runner');
  const tcb = await getScraper('tcbscans');
  assert.ok(tcb, 'TCB Scans scraper found');
  assert.strictEqual(tcb?.baseUrl, 'https://tcbonepiecechapters.com');
  assert.strictEqual(tcb?.lang, 'en');
});

test('runner.getScraperForUrl matches by baseUrl', async () => {
  const { getScraperForUrl } = await import('../src/runner');
  const scraper = await getScraperForUrl('https://tcbonepiecechapters.com/projects');
  assert.ok(scraper, 'Scraper found for URL');
  assert.strictEqual(scraper?.name, 'TCB Scans');
});

test('pipeline module loads', async () => {
  const mod = await import('../src/pipeline');
  assert.ok(typeof mod.findMatchingScrapers === 'function');
  assert.ok(typeof mod.scrapeMedia === 'function');
});

test('worker module loads', async () => {
  const mod = await import('../src/worker');
  assert.ok(typeof mod.processMedia === 'function');
});
