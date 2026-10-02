import test from 'node:test';
import assert from 'node:assert';
import { EveriaClubComScraper } from '../definitions/webtoons/all/everiaclubcom';
import { HennojinScraper } from '../definitions/webtoons/all/hennojin';

/**
 * Ces tests verrouillent le titre renvoye par `getMangaDetails`.
 *
 * Les deux scrapers sont des transcriptions de sources Kt qui laissent
 * `details.title` vide. Le backend s'appuie pourtant sur ce champ pour afficher
 * une fiche, et aucun test ne le couvrait : les deux ports ont livre des fiches
 * sans titre en production. Chaque fixture reproduit la structure observee sur le
 * site reel, reduite aux seuls selecteurs que le port lit.
 */

type GetSpy = { get: (url: string) => Promise<{ data: string }> };

/** Scraper dont `get` sert une fixture unique pour toute URL. */
function stubbed<T>(scraper: T, html: string): T {
  (scraper as unknown as GetSpy).get = async (): Promise<{ data: string }> => ({ data: html });
  return scraper;
}

/**
 * WordPress sert le titre anglais dans `<title>` (suffixe « – Hennojin »), mais
 * `h1.manga-title` ne contient que l'original japonais. Le port doit preferer
 * `<title>` : c'est la seule chaine identique a celle du catalogue.
 */
const hennojinDetail = (english: string, japanese: string): string => `<html><head>
<title>${english} – Hennojin</title>
</head><body><h1 class="manga-title">${japanese}</h1></body></html>`;

test('hennojin : le titre est celui du catalogue, pas le japonais de h1', async () => {
  const s = stubbed(
    new HennojinScraper(),
    hennojinDetail('(CiNDERELLA ☆ STAGE 7 STEP) [English]', '(シンデレラガールズ) [日本語訳]'),
  );

  const details = await s.getMangaDetails('/home/manga/cinderella/');

  assert.strictEqual(details.title, '(CiNDERELLA ☆ STAGE 7 STEP) [English]');
});

test('hennojin : le suffixe « – Hennojin » est retire', async () => {
  const s = stubbed(new HennojinScraper(), hennojinDetail('Doujin Works [English]', '同人作品 [日本語訳]'));

  const details = await s.getMangaDetails('/home/manga/doujin/');

  assert.ok(!details.title?.includes('Hennojin'), `suffixe conserve: ${details.title}`);
  assert.strictEqual(details.title, 'Doujin Works [English]');
});

test('hennojin : un titre deja sans suffixe reste intact', async () => {
  const s = stubbed(new HennojinScraper(), hennojinDetail('Plain Title', '日本語訳'));

  const details = await s.getMangaDetails('/home/manga/plain/');

  assert.strictEqual(details.title, 'Plain Title');
});

/** Sur everiaclubcom, `h1` porte exactement la chaine du catalogue (verifie en ligne). */
const everiaDetail = (title: string): string => `<html><body><h1>${title}</h1></body></html>`;

test('everiaclubcom : le titre vient de h1', async () => {
  const s = stubbed(new EveriaClubComScraper(), everiaDetail('Stella – Bimilstory Vol.09'));

  const details = await s.getMangaDetails('/manga/stella/');

  assert.strictEqual(details.title, 'Stella – Bimilstory Vol.09');
});

test('everiaclubcom : une page sans h1 ne renvoie pas de titre vide', async () => {
  const s = stubbed(new EveriaClubComScraper(), '<html><body><div class="mainleft"></div></body></html>');

  const details = await s.getMangaDetails('/manga/sans-titre/');

  assert.strictEqual(details.title, undefined, 'pas de chaine vide renvoyee au backend');
});

test('hennojin : une page sans <title> ne renvoie pas de chaine vide', async () => {
  const s = stubbed(new HennojinScraper(), '<html><body><h1 class="manga-title">Japanese only</h1></body></html>');

  const details = await s.getMangaDetails('/home/manga/sans-title/');

  assert.strictEqual(details.title, undefined, 'pas de chaine vide renvoyee au backend');
});