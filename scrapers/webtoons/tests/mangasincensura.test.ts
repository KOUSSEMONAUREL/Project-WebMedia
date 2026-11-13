import test from 'node:test';
import assert from 'node:assert';
import { MangasSinCensuraScraper } from '../definitions/webtoons/all/mangasincensura';

type GetSpy = { get: (url: string, config?: unknown) => Promise<{ data: string }>; calls: string[] };

function stubbed<T>(scraper: T, routes: Record<string, string>): T {
  const spy = scraper as unknown as GetSpy;
  spy.calls = [];
  spy.get = async (url: string) => {
    spy.calls.push(url);
    const data = routes[url];
    if (data === undefined) throw new Error(`route inconnue: ${url}`);
    return { data };
  };
  return scraper;
}

const manifest = 'https://img.mangasincensura.com/manhwas/stored_one/ch001/manifest.json';
const manifestPage = JSON.stringify({
  pages: [
    { page: 1, file: '0001.webp' },
    { page: 2, file: '0002.webp' },
  ],
});

const dataAsset = `
const a={
  serie_one:{rating:9.5,category:"CATEGORÍA",tenant:"msc",id:"serie_one",storageSlug:"stored_one",title:"SÉRIE UN",description:"Descripción con \\"citation\\".",totalChapters:3,publishedLimit:3,isCompleted:!1,hasChapterZero:!1,freeLimit:2,heroImage:"/assets/hero.webp",covers:["/assets/cover.webp"],subtitle:"TEST"},
  alias_one:{rating:9.5,category:"CATEGORÍA",tenant:"msc",id:"serie_one",title:"SÉRIE UN",description:"Alias",totalChapters:3,publishedLimit:3,isCompleted:!1,hasChapterZero:!1,freeLimit:2,heroImage:"/assets/hero.webp",covers:["/assets/cover.webp"]},
  finished_one:{rating:8.2,category:"OTRA",tenant:"msc",id:"finished_one",title:"FINI",description:"Terminé.",totalChapters:1,publishedLimit:1,isCompleted:!0,hasChapterZero:!0,freeLimit:1,heroImage:"/assets/f.webp",covers:[]}
};const s=[];export{a as M,s as a};
`;

function scraperWithRoutes(): MangasSinCensuraScraper {
  return stubbed(new MangasSinCensuraScraper(), {
    'https://mangasincensura.com/manhwa_index': `<html><head><link rel="modulepreload" href="/assets/manhwa-data-test.js"></head></html>`,
    'https://mangasincensura.com/assets/manhwa-data-test.js': dataAsset,
    [`https://mangasincensura.com/api/manifest?url=${encodeURIComponent(manifest)}`]: manifestPage,
  });
}

test('mangasincensura: catalogue dédupliqué et cartes construites depuis le JS de données', async () => {
  const s = scraperWithRoutes();

  const popular = await s.getPopular(1);
  assert.strictEqual(popular.mangas.length, 2);
  assert.deepStrictEqual(popular.mangas.map(m => m.title), ['SÉRIE UN', 'FINI']);
  assert.strictEqual(popular.mangas[0].url, 'https://mangasincensura.com/manhwa_index?id=serie_one');
  assert.strictEqual(popular.mangas[0].thumbnailUrl, 'https://mangasincensura.com/assets/hero.webp');
  assert.strictEqual(popular.mangas[0].genre, 'CATEGORÍA');
  assert.strictEqual(popular.mangas[0].status, 1);
  assert.strictEqual(popular.hasNextPage, false);

  const pageTwo = await s.getLatest(2);
  assert.deepStrictEqual(pageTwo, { mangas: [], hasNextPage: false });
});

test('mangasincensura: recherche accent-insensible et fiche sans requête réseau', async () => {
  const s = scraperWithRoutes();

  const found = await s.getSearch('serie un', 1);
  assert.deepStrictEqual(found.mangas.map(m => m.title), ['SÉRIE UN']);

  const byCategory = await s.getSearch('categoria', 1);
  assert.deepStrictEqual(byCategory.mangas.map(m => m.title), ['SÉRIE UN']);

  const details = await s.getMangaDetails('/manhwa_index?id=serie_one');
  assert.strictEqual(details.title, 'SÉRIE UN');
  assert.strictEqual(details.description, 'Descripción con "citation".');
  assert.strictEqual(details.url, 'https://mangasincensura.com/manhwa_index?id=serie_one');
});

test('mangasincensura: chapitres ordonnés et verrouillés au-delà de freeLimit', async () => {
  const s = scraperWithRoutes();
  const chapters = await s.getChapterList('/manhwa_index?id=serie_one');

  assert.deepStrictEqual(chapters.map(c => c.name), ['Capítulo 1', 'Capítulo 2', '🔒 Capítulo 3']);
  assert.deepStrictEqual(chapters.map(c => c.url), [
    'https://mangasincensura.com/chapter?manhwa=serie_one&cap=01',
    'https://mangasincensura.com/chapter?manhwa=serie_one&cap=02',
    'https://mangasincensura.com/chapter?manhwa=serie_one&cap=03',
  ]);
  assert.deepStrictEqual(chapters.map(c => c.chapterNumber), [1, 2, 3]);
});

test('mangasincensura: pages via /api/manifest avec storageSlug', async () => {
  const s = scraperWithRoutes();
  const pages = await s.getPageList('/chapter?manhwa=serie_one&cap=01');

  assert.deepStrictEqual(pages.map(p => p.imageUrl), [
    'https://img.mangasincensura.com/manhwas/stored_one/ch001/0001.webp',
    'https://img.mangasincensura.com/manhwas/stored_one/ch001/0002.webp',
  ]);
  assert.deepStrictEqual(pages.map(p => p.index), [0, 1]);
});

test('mangasincensura: chapitre VIP refusé sans requête manifest', async () => {
  const s = scraperWithRoutes();
  await assert.rejects(
    () => s.getPageList('/chapter?manhwa=serie_one&cap=03'),
    /VIP-only/,
  );
});
