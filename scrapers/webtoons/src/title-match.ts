/**
 * Matching de titres webtoons.
 *
 * Le test precedent etait `source.includes(media)` : unidirectionnel et
 * sensible a la ponctuation. AniList rend "One Punch-Man", la source rend
 * "One Punch Man" -- le tiret suffit a perdre le match, alors que la source
 * est correcte. Meme asymetrie sur les suffixes : "Sousou no Frieren" ne
 * matche pas "Frieren: Beyond Journey's End".
 *
 * On aligne donc sur la methode deja employee par novel-worker (jaccard sur
 * les mots, seuil 0.2, meilleur l'emporte), en ajoutant deux garde-fous que le
 * jeu n'a pas besoin :
 *
 * - une comparaison sans ponctuation, pour que "-", "'", "." et les crochets
 *   ne comptent jamais comme une difference ;
 * - un score exige au moins un mot entier commun, parce que jaccard seul
 *   accepte du bruit ("the" contre "berserk" plafonne a 0).
 *
 * Le sens reste symetrique : contains(A,B) || contains(B,A), avec un seuil.
 * Aucun de ces tests n'accepte un titre entierement different : ils ne
 * rapprochent que des variantes du meme titre.
 */

/** Minuscules, accents retires, ponctuation reduite a des espaces. */
export function canonicalize(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de',
  'of', 'and', 'et', 'to', 'en',
]);

/** Mots significatifs, longueur > 2, sans bruit editorial. */
function significantWords(title: string): Set<string> {
  return new Set(
    canonicalize(title)
      .split(' ')
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/**
 * Jaccard sur les mots significatifs, dans [0, 1].
 * Meme formulation que novel-worker/src/index.ts pour que les deux workers
 * classent de facon comparable.
 */
export function jaccard(a: string, b: string): number {
  const wordsA = significantWords(a);
  const wordsB = significantWords(b);
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersect = 0;
  for (const w of wordsA) if (wordsB.has(w)) intersect++;
  return intersect / (wordsA.size + wordsB.size - intersect);
}

/** Un mot entier partage, comparaison sans ponctuation. */
function sharesWholeWord(a: string, b: string): boolean {
  const wordsB = significantWords(b);
  if (wordsB.size === 0) return false;
  return [...significantWords(a)].some((w) => wordsB.has(w));
}

/**
 * Score de correspondance entre le titre du media et celui renvoye par une
 * source. 0 = pas le meme titre, 1 = identique.
 *
 * Trois etages, du plus fort au plus faible :
 *  1. egalite canonique ("One Punch-Man" == "One Punch Man") -> 1
 *  2. containment symetrique sur la forme canonique, mais seulement si le plus
 *     court est assez long ("Frieren" dans "Sousou no Frieren" -> 0.9).
 *     Sans cette garde de longueur, "One Piece" containment "One Punch Man"
 *     donnerait 0.25 et un match a un titre different.
 *  3. jaccard sur les mots, exigeant un mot entier partage et un seuil assez
 *     haut pour que le bruit editorial ne suffise pas.
 *
 * Le seuil de l'etage 3 est calcule sur un cas qui doit rester un echec :
 * "Re:Zero" / "Zero no Tsukaima" ne partagent que "zero" (1 mot sur 4 et 3,
 * jaccard 0.50) et "Darker than Black" / "Black Clover" ne partagent que
 * "black" (jaccard 0.33). Il faut plus de 0.50 pour ecarter les deux.
 * "Frieren: Beyond Journey's End" a 0.2.
 */
export function titleMatchScore(mediaTitle: string, sourceTitle: string): number {
  const a = canonicalize(mediaTitle);
  const b = canonicalize(sourceTitle);
  if (!a || !b) return 0;
  if (a === b) return 1;

  // Containment : le plus court doit etre assez long pour que le mot contenu
  // ne soit pas un accident editorial. "One Piece" est trop court pour etre
  // trouve dans "One Punch Man", "Berserk deluxe" assez long pour matcher.
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length >= 5 && longer.includes(shorter)) return 0.9;

  if (!sharesWholeWord(a, b)) return 0;
  const score = jaccard(mediaTitle, sourceTitle);
  return score >= PARTIAL_MATCH_THRESHOLD ? score : 0;
}

/**
 * Seuil de l'etage 3 (jaccard partiel). Calibre sur les cas negatifs :
 * "Re:Zero"/"Zero no Tsukaima" = 0.50, "Darker than Black"/"Black Clover" = 0.33,
 * "One Punch-Man"/"One Piece" = 0.25. Tous doivent rester a 0, donc seuil > 0.50.
 */
const PARTIAL_MATCH_THRESHOLD = 0.55;

/** Plafond de securite : au-dessus, on accepte sans seuil. */
export const TITLE_MATCH_THRESHOLD = 0.9;

/**
 * Vrai si les deux titres designent la meme oeuvre.
 *
 * On ne compare pas le score a un seuil unique : `titleMatchScore` melange deux
 * intentions (identite stricte = 1, containment long = 0.9, partiel = jaccard).
 * Un seuil lineaire ne peut pas distinguer "0.9 par containment" de "0.9 par
 * jaccard faible", et un seuil bas laisserait repasser "One Punch-Man" contre
 * "One Piece". On redemande donc les conditions explicites : la decision devient
 * lisible, et chaque cas est testable isolement.
 */
export function isSameTitle(mediaTitle: string, sourceTitle: string): boolean {
  const a = canonicalize(mediaTitle);
  const b = canonicalize(sourceTitle);
  if (!a || !b) return false;
  if (a === b) return true;

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length >= 5 && longer.includes(shorter)) return true;

  if (!sharesWholeWord(a, b)) return false;
  return jaccard(mediaTitle, sourceTitle) >= PARTIAL_MATCH_THRESHOLD;
}

/**
 * Titre vide apres canonicalisation : ne peut rien matcher, et surtout ne doit
 * pas faire matcher n'importe quoi par containment.
 */
export function isUsableTitle(title: string | undefined | null): boolean {
  return canonicalize(title ?? '').length >= 3;
}
