import test from 'node:test';
import assert from 'node:assert';
import { BaobuaScraper } from '../definitions/webtoons/all/baobua';
import type { Page } from '../engine/types';

// Ces tests verrouillent la transcription de `all/baobua` (BaoBua.kt) sur deux
// points que le site lui-meme ne permet pas de verifier par sondes, parce
// qu'aucune galerie en ligne n'est paginee au moment de l'ecriture :
//  1. la boucle `Next »` de `getPageList` (offsets, arret, garde-fou) ;
//  2. le titre de fiche, car `h2.box-mt-output` designe 4 blocs sur la page et
//     le premier est un slot publicitaire ("Advertising"). Le Kt upstream en
//     tire donc un titre faux ; ce port preferait `og:title`.
//
// Les corps HTML sont des fixtures minimaux reduits a la seule structure que les
// selecteurs observent sur le site reel.

/** Fiche galerie : `n` images servies par le CDN wp.com + un lien de pagination. */
const galleryPage = (n: number, next?: string): string => `<html><body>
<div class="contentme">
${Array.from({ length: n }, (_, i) => `<a href="/img.html"><img src="https://i0.wp.com/x${i}.jpg?w=640"></a>`).join('')}
</div>
${next ? `<a class="page-numbers" href="${next}">Next »</a>` : ''}
</body></html>`;

type GetSpy = { get: (url: string) => Promise<{ data: string }>; calls: string[] };

/** Scraper dont `get` est branche sur une table URL -> HTML, avec journal d'appels. */
function stubbed(routes: Record<string, string>): BaobuaScraper {
  const scraper = new BaobuaScraper() as unknown as GetSpy;
  const calls: string[] = [];
  scraper.calls = calls;
  scraper.get = async (url: string) => {
    calls.push(url);
    const data = routes[url];
    if (data === undefined) throw new Error(`route inconnue: ${url}`);
    return { data };
  };
  return scraper as unknown as BaobuaScraper;
}

const callsOf = (s: BaobuaScraper): string[] => (s as unknown as GetSpy).calls;
const urlsOf = (pages: Page[]): string[] => pages.map((p) => p.imageUrl);

test('galerie sur une page : index contigus et vignette wp.com normalisee', async () => {
  const s = stubbed({ 'https://baobua.net/spot/a.html': galleryPage(3) });
  const pages = await s.getPageList('/spot/a.html');

  assert.deepStrictEqual(pages.map((p) => p.index), [0, 1, 2]);
  // `https://iN.wp.com/...?w=640` -> `https://...?w=640` puis retrait de `?w=640`.
  assert.deepStrictEqual(urlsOf(pages), [
    'https://x0.jpg',
    'https://x1.jpg',
    'https://x2.jpg',
  ]);
  assert.strictEqual(callsOf(s).length, 1, 'une seule requete : pas de pagination');
});

test('galerie paginee : les index sont decales, jamais reinitialises', async () => {
  const s = stubbed({
    'https://baobua.net/spot/b.html': galleryPage(2, '/spot/b.html?page=2'),
    'https://baobua.net/spot/b.html?page=2': galleryPage(2, '/spot/b.html?page=3'),
    'https://baobua.net/spot/b.html?page=3': galleryPage(1),
  });
  const pages = await s.getPageList('/spot/b.html');

  assert.strictEqual(pages.length, 5, '2 + 2 + 1 images cumulees');
  assert.deepStrictEqual(pages.map((p) => p.index), [0, 1, 2, 3, 4]);
  assert.deepStrictEqual(urlsOf(pages), [
    'https://x0.jpg',
    'https://x1.jpg',
    'https://x0.jpg',
    'https://x1.jpg',
    'https://x0.jpg',
  ]);
  assert.strictEqual(callsOf(s).length, 3);
});

test('un lien Next qui pointe sur lui-meme ne boucle pas indefiniment', async () => {
  const s = stubbed({ 'https://baobua.net/spot/c.html': galleryPage(2, '/spot/c.html') });
  const pages = await s.getPageList('/spot/c.html');

  assert.strictEqual(pages.length, 2);
  assert.strictEqual(callsOf(s).length, 1, 'la 2e visite de la meme URL est refusee');
});

test('un lien de pagination numerote n\'est pas suivi (contenant "Next")', async () => {
  // Reproduit le `:contains(Next)` du Kt : un lien "2" ne doit pas avancer.
  const numbered = (n: number, next?: string): string => `<html><body>
<div class="contentme">
${Array.from({ length: n }, (_, i) => `<a href="/img.html"><img src="https://i0.wp.com/x${i}.jpg?w=640"></a>`).join('')}
</div>
${next ? `<a class="page-numbers" href="${next}">2</a>` : ''}
</body></html>`;

  const s = stubbed({
    'https://baobua.net/spot/d.html': numbered(2, '/spot/d.html?page=2'),
    'https://baobua.net/spot/d.html?page=2': numbered(1),
  });
  const pages = await s.getPageList('/spot/d.html');

  assert.strictEqual(pages.length, 2);
  assert.strictEqual(callsOf(s).length, 1);
});

test('le titre de fiche vient de og:title, pas du premier h2 (pub)', async () => {
  // Structure reelle relevee sur baobua.net : 4 blocs `h2.box-mt-output`, dont
  // "Advertising" et "NOW" precedent le vrai titre.
  const s = stubbed({
    'https://baobua.net/spot/e.html': `<html><head>
<title>BaoBua.Net: Titre reel | Page 2/7</title>
<meta property="og:title" content="BaoBua.Net: Titre reel | Page 2/7">
</head><body>
<h2 class="box-mt-output">Advertising</h2>
<h2 class="box-mt-output">NOW</h2>
<h2 class="box-mt-output">BaoBua.Net: Titre reel | Page 2/7</h2>
<div class="contentme"><a href="/img.html"><img src="https://i1.wp.com/a.jpg?w=640"></a></div>
<div class="it-categories"><a>bikini</a><a>Vietnam</a></div>
</body></html>`,
  });

  const det = await s.getMangaDetails('/spot/e.html');
  // Prefixe "BaoBua.Net: " et suffixe " | Page 2/7" retires.
  assert.strictEqual(det.title, 'Titre reel');
  assert.strictEqual(det.genre, 'bikini, Vietnam');
  assert.strictEqual(det.status, 0, 'une galerie est COMPLETED');
});

test('la date de publication est lue dans le JSON-LD, offset en huities', async () => {
  for (const raw of ['2026-10-01T14:52:05+00:00', '2026-10-01T14:52:05', '2026-10-01T14:52:05Z']) {
    const s = stubbed({
      'https://baobua.net/spot/f.html':
        `<html><body>{"datePublished":"${raw}"}<div class="contentme"></div></body></html>`,
    });
    const chapters = await s.getChapterList('/spot/f.html');
    assert.strictEqual(chapters.length, 1);
    assert.strictEqual(chapters[0].name, 'Gallery');
    const d = chapters[0].dateUpload;
    assert.notStrictEqual(d, undefined, `date absente pour "${raw}"`);
    assert.strictEqual(new Date(d as number).toISOString().slice(0, 10), '2026-10-01');
  }
});

test('une date absente laisse dateUpload non defini (le Kt y met 0)', async () => {
  const s = stubbed({
    'https://baobua.net/spot/g.html': '<html><body><div class="contentme"></div></body></html>',
  });
  const chapters = await s.getChapterList('/spot/g.html');
  assert.strictEqual(chapters.length, 1);
  assert.strictEqual(chapters[0].dateUpload, undefined);
  assert.strictEqual(chapters[0].url, '/spot/g.html', 'repli sur l URL de la requete');
});

test('link[rel=canonical] prime sur l URL de la requete pour le chapitre', async () => {
  const s = stubbed({
    'https://baobua.net/spot/h.html': `<html><head>
<link rel="canonical" href="https://baobua.net/spot/h-canonique.html">
</head><body><div class="contentme"></div></body></html>`,
  });
  const chapters = await s.getChapterList('/spot/h.html');
  assert.strictEqual(chapters[0].url, '/spot/h-canonique.html');
});