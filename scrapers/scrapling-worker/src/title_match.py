"""Rapprochement entre le jeu cherche et le titre d'une fiche trouvee sur une
source de telechargement.

Les pages de recherche sont ambigues: une requete "Chrono Trigger" renvoie
aussi bien "Cris Tales" ou "DELTARUNE". Avant, chaque lien de la page etait
impute au jeu demande, d'ou des liens d'autres jeux en base.

Le rapprochement est tempere:
- les CHIFFRES doivent correspondre exactement ("Baldur's Gate" ne vaut pas
  "Baldur's Gate 3"), c'est le seul point non negociable;
- le reste est tolere dans les deux sens: le candidat peut contenir des mots de
  bruit en trop ("Free Download", "FitGirl Repack", "v1.2"), et quelques
  variante orthographiques sont absorbees.
"""

import html
import re
import unicodedata
from difflib import SequenceMatcher

# Suffixes d'edition/pack : identifies et retires en fin de titre.
EDITION_WORDS = (
    r"(?:edition|bundle|collection|pack|combo|version|deluxe|definitive|ultimate|"
    r"complete|gold|premium|standard|special|enhanced|remastered?|remake|goty|"
    r"game\s+of\s+the\s+year|anniversary|collector'?s?)"
)

# Mots de bruit frequents en fin de titre sur ces sites. Les mots grammaticaux
# ("the", "of", "and") sont ici car ils sont ignores des DEUX cotes: sinon un
# candidat comme "Sea of Stars" perdrait "of" et le titre wanted l'exigerait,
# ce qui rejetterait a tort un vrai match.
TAIL_NOISE = {
    "free", "download", "pc", "repack", "full", "game", "edition", "deluxe",
    "definitive", "ultimate", "complete", "gold", "premium", "standard",
    "special", "collectors", "collector", "enhanced", "digital", "goty",
    "remastered", "remaster", "remake", "anniversary", "infernal",
    "ultimate", "turbocharged", "definitive", "deluxe", "extended",
    "dlc", "dlcs", "update", "bonus", "content", "soundtrack", "crack",
    "fitgirl", "dodi", "plaza", "elamigos", "tenfile", "multi", "gog",
    "of", "year", "the", "and", "all", "new", "a", "an",
}

ROMAN = {
    "ii": "2", "iii": "3", "iv": "4", "v": "5", "vi": "6",
    "vii": "7", "viii": "8", "ix": "9", "x": "10", "xi": "11", "xii": "12",
}

# Numeros de version a ignorer: v1.2, b12, 20230101, 1.0.0.4
VERSION_RE = re.compile(r"^(v?\d+(\.\d+)+[a-z]?|b\d+|build\d*|\d{6,}|\d+\.\d+)$")

# Faux positifs frequents quand la page de recherche renvoie n'importe quoi.
JUNK_TITLES = {"", "404", "error", "page not found", "jeux", "games", "home"}

DASH_SPLIT = re.compile(r"\s*[:\-–—|]\s*")


def _strip_accents(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()


def tokenize(text: str) -> list:
    """Minuscules, sans accents, sans ponctuation, numeros romains convertis."""
    if not text:
        return []
    text = html.unescape(text)
    text = _strip_accents(text).lower()
    text = text.replace("'", "").replace("\u2019", "")
    text = re.sub(r"\[[^\]]*\]|\([^)]*\)", " ", text)
    text = re.sub(r"[^a-z0-9.]+", " ", text)
    tokens = [ROMAN.get(t, t) for t in text.split()]
    # "The Witcher 3" -> "Witcher 3" : les articles de tete ne portent pas de sens
    while tokens and tokens[0] in ("the", "a", "an"):
        tokens = tokens[1:]
    return tokens


COLLECTION_RE = re.compile(r"^(collection|partie|part|volume|vol|tome)\d*$")
COLLECTION_SEGMENT_RE = re.compile(
    r"^(collection|partie|part|volume|vol|vol\.|tome|chapitre)\s*\d+$", re.IGNORECASE
)
# Suffixe d'edition en fin de segment: "Deluxe Edition", "Game of the Year
# Edition". Aucun mot ne doit etre consomme AVANT le suffixe, sinon
# "Shadow of the Erdtree Edition" perdrait "Erdtree": c'est le sous-titre du jeu.
EDITION_TAIL_RE = re.compile(rf"\s*(?:{EDITION_WORDS})\s*$", re.IGNORECASE)


def significant(tokens: list) -> list:
    """Jette les mots grammaticaux et le bruit, des deux cotes.

    "Collection 1" disparait completement: le mot ET son numero, sinon le "1"
    serait compare aux numeros du titre et ferait echouer la correspondance.
    """
    out = []
    skip_next_number = False
    for t in tokens:
        if COLLECTION_RE.match(t):
            skip_next_number = True
            continue
        if skip_next_number and (VERSION_RE.match(t) or t.isdigit()):
            skip_next_number = False
            continue
        skip_next_number = False
        if t not in TAIL_NOISE:
            out.append(t)
    return out


def strip_edition(name: str) -> str:
    """'Baldur\'s Gate 3: Digital Deluxe Edition' -> 'Baldur\'s Gate 3'.

    On retire les suffixes d'edition, mais UNIQUEMENT le suffixe lui-meme.
    L'ancien code popping en tres entier un segment des que celui-ci contenait
    un mot d'edition, ce qui tronquait les sous-titres:

        "Elden Ring: Shadow of the Erdtree Edition"
            -> segment "Shadow of the Erdtree Edition".pop()
            -> "Elden Ring"

    Le jeu etait alors recherche sous le nom du jeu de base, et ses propres
    liens de base remonteient en face de l'extension.
    """
    if not name:
        return ""
    parts = [p.strip() for p in DASH_SPLIT.split(name.strip()) if p.strip()]

    # "Collection 1", "Partie 2", "Volume 3": un numero de collection n'est pas
    # un numero de jeu. Il ne doit ni rester dans le titre, ni etre compare aux
    # numeros du titre, sinon "Modern Warfare 3 - Collection 1" ne matche pas.
    if len(parts) > 1 and COLLECTION_SEGMENT_RE.match(parts[-1]):
        parts.pop()

    # On rogne le suffixe d'edition en fin de segment, sans toucher au reste.
    # "Shadow of the Erdtree Edition" -> "Shadow of the Erdtree",
    # "Arkham Collection" -> "Arkham", "Deluxe Edition" -> "" (segment gone).
    while True:
        if not parts:
            break
        last = parts[-1]
        trimmed = EDITION_TAIL_RE.sub("", last).strip()
        if trimmed != last:
            parts[-1] = trimmed
            continue
        if parts and COLLECTION_SEGMENT_RE.match(last):
            parts.pop()
            continue
        if len(parts) > 1 and re.search(rf"\b{EDITION_WORDS}\b", last, re.IGNORECASE):
            # Le segment ne se termine pas par un suffixe mais en contient un
            # ("Shadow of the Erdtree Edition Complete"): on le garde, le bruit
            # sera de toute facon jete par significant() plus bas.
            break
        break

    while parts and not parts[-1]:
        parts.pop()
    return " ".join(parts).strip() or name.strip()


def title_forms(wanted: str) -> list:
    """Formes acceptees du titre, de la plus longue a la plus courte.

    Toutes les formes sont retirees d'abord de leur suffixe d'edition, puis on
    retirees le dernier segment, encore et encore:

        "Elden Ring: Shadow of the Erdtree Edition"
            -> "Elden Ring Shadow of the Erdtree", puis "Elden Ring"
        "Devil May Cry 5: Devil Hunter Edition"
            -> "Devil May Cry 5 Devil Hunter", puis "Devil May Cry 5"

    Le segment manquant est parfois un vrai sous-titre (Shadow of the Erdtree)
    et parfois le nom de l'edition (Devil Hunter). Les deux formes sont donc
    essaiees, de la plus longue a la plus courte: c'est la plus longue qui
    matche qui l'emporte, donc un titre partiel ne peut pas "voler" un match a
    une forme longue qui aurait du matcher.
    """
    if not wanted:
        return []
    parts = [p.strip() for p in DASH_SPLIT.split(wanted.strip()) if p.strip()]
    forms = [strip_edition(" ".join(parts))]
    # On n'ampute le DERNIER segment que s'il ressemble a un qualificatif
    # d'edition ("Devil Hunter Edition", "Arkham Collection"): la, ce n'est
    # qu'un habillage. Un segment comme "Calamity Mod" ou "Shadow of the
    # Erdtree" nomme une oeuvre differente, et l'amputer ferait accepter le jeu
    # de base pour son extension ou son mod.
    while len(parts) > 1 and re.search(rf"\b{EDITION_WORDS}\b", parts[-1], re.IGNORECASE):
        parts.pop()
        form = strip_edition(" ".join(parts))
        if form and form not in forms:
            forms.append(form)
    return [f for f in forms if f]


def search_query(game_name: str) -> str:
    """Version normalisee pour l'URL de recherche."""
    tokens = tokenize(strip_edition(game_name))
    return " ".join(tokens) if tokens else (game_name or "").strip()


def _clean_candidate(tokens: list) -> list:
    tokens = significant(tokens)
    while tokens and VERSION_RE.match(tokens[-1]):
        tokens = tokens[:-1]
    return tokens


def _numbers(tokens: list) -> set:
    """Les chiffres significatifs: les numeros de version sont deja retires."""
    return {t for t in tokens if any(ch.isdigit() for ch in t)}


def match_title(wanted: str, candidate: str, aliases=None, parent=None):
    """Retourne 'exact', 'alias' ou None (jamais 'fuzzy': trop permissif).

    `parent` est le jeu de base d'IGDB, dans le cas d'une extension. Ce n'est
    PAS un alias: "Elden Ring: Shadow of the Erdtree" a pour parent "Elden
    Ring", mais les liens du jeu de base ne sont pas ceux de l'extension. Un
    candidat qui ne correspond qu'au parent est donc rejete explicitement.
    """
    if candidate is None:
        return None
    low = _strip_accents(html.unescape(candidate)).lower().strip()
    if low in JUNK_TITLES:
        return None

    cand = _clean_candidate(tokenize(candidate))
    if not cand:
        return None

    def compare(want_raw: str):
        want = significant(tokenize(strip_edition(want_raw)))
        if not want:
            return None
        # 1. Les chiffres doivent etre identiques. C'est la regle qui bloque
        #    "Baldur's Gate" pour "Baldur's Gate 3" et "Elden Ring (2022)" pour
        #    "Shadow of the Erdtree".
        if _numbers(want) != _numbers(cand):
            return None
        # 2. Le candidat ne doit pas AJOUTER de mots significatifs absents du
        #    titre voulu. Sans cette regle, "Doom" (wanted) acceptait "Doom
        #    Eternal" et "Elden Ring" acceptait "Elden Ring Nightreign", qui
        #    sont d'autres jeux. Le bruit est deja retire par significant().
        cand_set = set(cand)
        want_set = set(want)
        extra = [t for t in cand if t not in want_set]
        if extra:
            return None
        # 3. Tous les mots du titre voulu doivent etre presents.
        missing = [t for t in want if t not in cand_set]
        if missing:
            # Tolerance sur une variante courte: un mot absent du candidat est
            # tolere si le reste colle vraiment (>=0.9 de similarite).
            ratio = SequenceMatcher(None, " ".join(want), " ".join(cand)).ratio()
            if ratio < 0.9 or len(missing) > 1:
                return None
        return True

    # Extension (parent connu): seule la forme COMPLETE est acceptable. Les
    # formes amputees tombent sur le jeu de base, dont les liens sont ceux
    # d'un autre jeu. Un jeu sans parent, lui, accepte toutes les formes.
    parents = [p.strip() for p in (parent or []) if p and p.strip()]
    forms = title_forms(wanted)
    if parents:
        forms = forms[:1]
    for form in forms:
        if compare(form):
            return "exact"
    for alias in aliases or []:
        if compare(alias):
            return "alias"
    return None


def pick(entries: list, wanted: str, aliases=None, per_source: int = 2, parent=None) -> list:
    """Filtre les entrees, trie exact > alias, puis limite.

    Filtrer avant de limiter: c'est l'inverse du comportement d'origine, qui
    prenait les 5 premiers liens de la page sans verifier.
    """
    scored = []
    for entry in entries:
        kind = match_title(wanted, entry.get("title"), aliases, parent)
        if kind:
            scored.append({**entry, "match_type": kind})
    order = {"exact": 0, "alias": 1}
    scored.sort(key=lambda e: order.get(e["match_type"], 2))
    return scored[:per_source]
