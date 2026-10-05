import test from 'node:test';
import assert from 'node:assert';
import { isSameTitle, titleMatchScore, canonicalize } from '../src/title-match';

/**
 * Ces tests verrouillent le matching de titres webtoons.
 *
 * Le test precedent etait `source.toLowerCase().includes(media.toLowerCase())` :
 * unidirectionnel et sensible a la ponctuation. AniList rend "One Punch-Man",
 * la source rend "One Punch Man" -- le tiret suffisait a perdre le match alors
 * que la source etait correcte, et le media partait en "No chapters found"
 * alors que la source existait.
 *
 * Les cas negatifs ne sont pas decoratifs : ils calibrent les seuils. Un
 * matching trop permissif est pire que l'ancien, car il rattache un media au
 * mauvais oeuvre et pollue la base avec des chapitres d'une autre serie.
 */

/** Meme oeuvre, orthographe ou suffes differents : doit matcher. */
const DOIVENT_MATCHER: [string, string][] = [
  ['One Punch-Man', 'One Punch Man'],
  ['One Punch-Man', 'One-Punch Man'],
  ['Re:Zero', 'Re Zero'],
  ['Kaguya-sama', 'Kaguya Sama'],
  ['Berserk', 'BERSERK'],
  ['Berserk', 'Berserk deluxe'],
  ['Chainsaw Man', 'Chainsaw Man JP'],
  ['Sousou no Frieren', 'Frieren'],
  ['The Amazing Spider-Man', 'Amazing Spider Man'],
  ['Attack on Titan', 'Attack on Titan (Wscan)'],
  ['Hunter x Hunter', 'Hunter X Hunter'],
];

/**
 * Oeuvres differentes : ne doit PAS matcher. Les trois derniers cas ont
 * commander le seuil de l'etage jaccard ; sans eux, "Re:Zero" se
 * rattacherait a "Zero no Tsukaima".
 */
const NE_DOIVENT_PAS_MATCHER: [string, string][] = [
  ['Berserk', 'Chainsaw Man'],
  ['Naruto', 'Bleach'],
  ['One Punch-Man', 'One Piece'],
  ['Darker than Black', 'Black Clover'],
  ['Re:Zero', 'Zero no Tsukaima'],
  ['Berserk', ''],
  ['Berserk', '   '],
];

test('canonicalize retire accents et ponctuation', () => {
  assert.equal(canonicalize('One Punch-Man'), 'one punch man');
  assert.equal(canonicalize('Re:Zero'), 're zero');
  assert.equal(canonicalize('Kaguya-sama'), 'kaguya sama');
  assert.equal(canonicalize("L'Amour"), 'lamour');
  assert.equal(canonicalize('Amelie'), 'amelie');
  assert.equal(canonicalize('Dr. Stone'), 'dr stone');
  assert.equal(canonicalize('  espaces   autour  '), 'espaces autour');
});

test('les variantes du meme titre matchent', () => {
  for (const [media, source] of DOIVENT_MATCHER) {
    assert.ok(
      isSameTitle(media, source),
      `"${media}" <= "${source}" devrait matcher (score ${titleMatchScore(media, source)})`,
    );
  }
});

test('les titres differents ne matchent pas', () => {
  for (const [media, source] of NE_DOIVENT_PAS_MATCHER) {
    assert.equal(
      isSameTitle(media, source),
      false,
      `"${media}" ne doit pas matcher "${source}" (score ${titleMatchScore(media, source)})`,
    );
  }
});

test('le matching est symetrique', () => {
  // L'ancien test ne l'etait pas : "Frieren" ne trouvait pas
  // "Sousou no Frieren" alors que l'inverse fonctionnait.
  for (const [a, b] of [['Sousou no Frieren', 'Frieren'], ['Frieren', 'Sousou no Frieren']]) {
    assert.equal(isSameTitle(a, b), isSameTitle(b, a), `asymetrie sur "${a}" / "${b}"`);
  }
});

test('un titre vide ne matche jamais, meme contre un titre court', () => {
  assert.equal(isSameTitle('', 'Berserk'), false);
  assert.equal(isSameTitle('Berserk', ''), false);
  // Sans ce cas, contains('', 'x') est vrai et tout matchait.
  assert.equal(isSameTitle('', ''), false);
});

/**
 * Limites assumees, documentees pour ne pas etre redécouvredes comme un bug.
 * Un spinoff partage le nom de sa serie mere ("Berserk of Gluttony II"), et
 * rien dans les chaines ne permet de le distinguer d'un suffixe de collection
 * ("Berserk deluxe"). Le containment les accepte donc.
 *
 * Les traiter demanderait des familles de titres, pas une comparaison de
 * chaines : c'est un chantier distinct, pas un ajustement de seuil.
 */
test('limites connues : un spinoff est accepte comme sa serie mere', () => {
  assert.equal(isSameTitle('Berserk', 'Berserk of Gluttony II'), true);
  assert.equal(isSameTitle('Solo Leveling', 'I Am Solo Leveling'), true);
});
