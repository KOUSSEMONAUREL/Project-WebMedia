import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';

test('mangadex.ts uses MangaDex API directly, no Consumet', async () => {
  const content = await import('../src/importers/mangadex');
  assert.ok(typeof content.importTrendingManga === 'function', 'function exported');

  const src = fs.readFileSync(
    new URL('../src/importers/mangadex.ts', import.meta.url),
    'utf-8'
  );
  assert.ok(!src.includes('@consumet/extensions'), 'no Consumet import');
  assert.ok(!src.includes('new MANGA.MangaDex'), 'no Consumet instance');
  assert.ok(src.includes('api.mangadex.org'), 'uses MangaDex API directly');
  assert.ok(src.includes('followedCount'), 'trending by followedCount');
  assert.ok(src.includes('MANGADEX_API'), 'uses API constant');
});

test('@consumet/extensions removed from package.json', async () => {
  const pkg = JSON.parse(
    fs.readFileSync(
      new URL('../package.json', import.meta.url),
      'utf-8'
    )
  );
  assert.ok(!pkg.dependencies['@consumet/extensions'], 'consumet removed from deps');
});
