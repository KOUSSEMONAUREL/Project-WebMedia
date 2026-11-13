import test from 'node:test';
import assert from 'node:assert';
import { CosplayRule34Scraper } from '../definitions/webtoons/all/cosplayrule34';
import { YesPornPicsScraper } from '../definitions/webtoons/all/yespornpics';

type GetSpy = { get: (url: string) => Promise<{ data: string }>; calls: string[] };

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

const callsOf = (scraper: unknown): string[] => (scraper as GetSpy).calls;

const cosplayCard = (id: string, title: string, thumb: string): string => `
  <div class="grid-item" onclick="location.href='/post/${id}';" style="background-image: url(${thumb});">
    <a href="/post/${id}">${title}</a>
  </div>`;

const cosplayList = (cards: string, next = false): string => `<html><body>
  <div class="grid">${cards}</div>
  ${next ? '<a class="d-none next" href="/?page=2"></a>' : ''}
</body></html>`;

test('cosplayrule34: liste, pagination et nettoyage des cartes publicitaires', async () => {
  const s = stubbed(new CosplayRule34Scraper(), {
    'https://cosplayrule34.com/': cosplayList(
      `${cosplayCard('1', 'Candy Ball - Jane Doe', 'https://cosplayrule34.com/a.webp')}
       <div class="grid-item"><ins data-zoneid="1"></ins></div>
       ${cosplayCard('2', 'Ratskeleton', 'https://cosplayrule34.com/b.webp')}`,
      true,
    ),
    'https://cosplayrule34.com/?page=2': cosplayList(cosplayCard('3', 'Page Two', 'https://cosplayrule34.com/c.webp')),
  });

  const first = await s.getLatest(1);
  assert.deepStrictEqual(first.mangas.map(m => m.title), ['Candy Ball - Jane Doe', 'Ratskeleton']);
  assert.strictEqual(first.mangas[0].thumbnailUrl, 'https://cosplayrule34.com/a.webp');
  assert.strictEqual(first.hasNextPage, true);

  const second = await s.getLatest(2);
  assert.deepStrictEqual(second.mangas.map(m => m.title), ['Page Two']);
  assert.strictEqual(second.hasNextPage, false);
});

test('cosplayrule34: la recherche garde les espaces et retombe sur deux mots', async () => {
  const s = stubbed(new CosplayRule34Scraper(), {
    'https://cosplayrule34.com/search/Candy%20Ball%20Jane%20Doe': cosplayList(''),
    'https://cosplayrule34.com/search/Candy%20Ball': cosplayList(
      cosplayCard('7', 'Candy Ball', 'https://cosplayrule34.com/candy.webp'),
    ),
  });

  const result = await s.getSearch('Candy Ball Jane Doe', 1);
  assert.deepStrictEqual(result.mangas.map(m => m.title), ['Candy Ball']);
  assert.deepStrictEqual(callsOf(s), [
    'https://cosplayrule34.com/search/Candy%20Ball%20Jane%20Doe',
    'https://cosplayrule34.com/search/Candy%20Ball',
  ]);
});

test('cosplayrule34: fiche et pages fancybox dedupliquees', async () => {
  const detail = `<html><head>
    <meta property="og:image" content="https://cosplayrule34.com/cover.webp">
  </head><body>
    <h1 class="h6">Alin Ma - Mei Mei</h1>
    <a href="/model/Alin-Ma">Alin Ma</a>
    <a href="/cosplay/Mei-Mei">Mei Mei</a>
    <a href="/fandom/Jujutsu-Kaisen">Jujutsu Kaisen</a>
    <div class="accordion-body">Exclusive leaked content.</div>
    <div id="photo-container">
      <a href="https://cosplayrule34.com/1.webp" data-fancybox="gallery"><img src="https://cosplayrule34.com/t1.webp"></a>
      <a href="https://cosplayrule34.com/2.webp" data-fancybox="gallery"><img src="https://cosplayrule34.com/t2.webp"></a>
      <a href="https://cosplayrule34.com/1.webp" data-fancybox="gallery"><img src="https://cosplayrule34.com/t1.webp"></a>
    </div>
  </body></html>`;

  const s = stubbed(new CosplayRule34Scraper(), {
    'https://cosplayrule34.com/post/1': detail,
  });

  const details = await s.getMangaDetails('https://cosplayrule34.com/post/1');
  assert.strictEqual(details.title, 'Alin Ma - Mei Mei');
  assert.strictEqual(details.author, 'Alin Ma');
  assert.strictEqual(details.genre, 'Mei Mei, Jujutsu Kaisen');
  assert.strictEqual(details.thumbnailUrl, 'https://cosplayrule34.com/cover.webp');

  const pages = await s.getPageList('https://cosplayrule34.com/post/1');
  assert.deepStrictEqual(pages.map(p => p.imageUrl), [
    'https://cosplayrule34.com/1.webp',
    'https://cosplayrule34.com/2.webp',
  ]);
  assert.deepStrictEqual(pages.map(p => p.index), [0, 1]);
});

test('yespornpics: liste, titre nettoye et pagination numerique', async () => {
  const page = (id: string, title: string, next: boolean): string => `<html><body>
    <div class="gallery">
      <a title="${title}" href="/sex/${id}"><img src="//x.uuu.cam/${id}.jpg" alt="${title}"></a>
    </div>
    ${next ? '<div class="nav"><a href="/sex/2">Next</a></div>' : ''}
  </body></html>`;

  const s = stubbed(new YesPornPicsScraper(), {
    'https://yespornpics.com/': page('gallery-one', 'yes! Victoria Lawson Slit Amateur porn pics', true),
    'https://yespornpics.com/sex/2': page('gallery-two', 'yes! Eva Notty Short Hair porn pics', false),
  });

  const first = await s.getLatest(1);
  assert.deepStrictEqual(first.mangas.map(m => m.title), ['Victoria Lawson Slit Amateur']);
  assert.strictEqual(first.mangas[0].url, 'https://yespornpics.com/sex/gallery-one');
  assert.strictEqual(first.mangas[0].thumbnailUrl, 'https://x.uuu.cam/gallery-one.jpg');
  assert.strictEqual(first.hasNextPage, true);

  const second = await s.getLatest(2);
  assert.deepStrictEqual(second.mangas.map(m => m.title), ['Eva Notty Short Hair']);
  assert.strictEqual(second.hasNextPage, false);
});

test('yespornpics: recherche par modele et pages jpeg uniquement', async () => {
  const search = `<html><body>
    <div class="gallery">
      <a title="yes! Victoria Lawson Test porn pics" href="/sex/victoria-test"><img src="//x.uuu.cam/t.jpg"></a>
    </div>
  </body></html>`;
  const detail = `<html><head>
    <meta property="og:title" content="Yes Porn Pics Victoria Lawson Test XXX Sex Gallery # 1">
    <meta property="og:image" content="https://x.uuu.cam/cover.jpg">
    <meta property="og:description" content="Gallery description">
  </head><body>
    <div class="relativetop"><a href="//x.uuu.cam/unrelated.jpg"><img src="//x.uuu.cam/unrelated-thumb.jpg"></a></div>
    <div class="jpeg"><a href="//x.uuu.cam/1.jpg"><img src="//x.uuu.cam/hd-1.jpg"></a></div>
    <div class="jpeg"><a href="//x.uuu.cam/2.jpg"><img src="//x.uuu.cam/hd-2.jpg"></a></div>
    <div class="jpeg"><a href="//x.uuu.cam/1.jpg"><img src="//x.uuu.cam/hd-1.jpg"></a></div>
  </body></html>`;

  const s = stubbed(new YesPornPicsScraper(), {
    'https://yespornpics.com/search.php?model=Victoria%20Lawson': search,
    'https://yespornpics.com/sex/victoria-test': detail,
  });

  const found = await s.getSearch('Victoria Lawson', 1);
  assert.deepStrictEqual(found.mangas.map(m => m.title), ['Victoria Lawson Test']);
  assert.strictEqual(found.hasNextPage, false);

  const details = await s.getMangaDetails('https://yespornpics.com/sex/victoria-test');
  assert.strictEqual(details.title, 'Victoria Lawson Test');
  assert.strictEqual(details.thumbnailUrl, 'https://x.uuu.cam/cover.jpg');

  const pages = await s.getPageList('https://yespornpics.com/sex/victoria-test');
  assert.deepStrictEqual(pages.map(p => p.imageUrl), [
    'https://x.uuu.cam/1.jpg',
    'https://x.uuu.cam/2.jpg',
  ]);
  assert.strictEqual(pages.some(p => p.imageUrl.includes('unrelated')), false);
});
