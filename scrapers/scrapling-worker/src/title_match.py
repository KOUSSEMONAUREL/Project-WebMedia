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


def significant(tokens: list) -> list:
    """Jette les mots grammaticaux et le bruit, des deux cotes."""
    return [t for t in tokens if t not in TAIL_NOISE]


def strip_edition(name: str) -> str:
    """'Baldur's Gate 3: Digital Deluxe Edition' -> 'Baldur's Gate 3'.

    Retire les segments finaux qui sont des suffixes d'edition, et un éventuel
    suffixe colle sans separateur ("Foo Definitive Edition").
    """
    if not name:
        return ""
    parts = [p.strip() for p in DASH_SPLIT.split(name.strip()) if p.strip()]
    while len(parts) > 1 and re.search(rf"\b{EDITION_WORDS}\b", parts[-1], re.IGNORECASE):
        parts.pop()
    base = " ".join(parts).strip()
    trimmed = re.sub(rf"\s+(\w+\s+)??{EDITION_WORDS}$", "", base, flags=re.IGNORECASE).strip()
    return trimmed or base


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


def match_title(wanted: str, candidate: str, aliases=None):
    """Retourne 'exact', 'alias' ou None (jamais 'fuzzy': trop permissif)."""
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
        #    "Baldur's Gate" pour "Baldur's Gate 3" et "Ben 10" pour "Gwent".
        if _numbers(want) != _numbers(cand):
            return None
        # 2. Tous les mots significatifs du titre voulu doivent etre presents.
        cand_set = set(cand)
        missing = [t for t in want if t not in cand_set]
        if missing:
            # Tolerance sur les variante courtes: un mot absent du candidat
            # est tolere si le reste colle vraiment (>=0.9 de similarite).
            ratio = SequenceMatcher(None, " ".join(want), " ".join(cand)).ratio()
            if ratio < 0.9 or len(missing) > 1:
                return None
        return True

    if compare(wanted):
        return "exact"
    for alias in aliases or []:
        if compare(alias):
            return "alias"
    return None


def pick(entries: list, wanted: str, aliases=None, per_source: int = 2) -> list:
    """Filtre les entrees, trie exact > alias, puis limite.

    Filtrer avant de limiter: c'est l'inverse du comportement d'origine, qui
    prenait les 5 premiers liens de la page sans verifier.
    """
    scored = []
    for entry in entries:
        kind = match_title(wanted, entry.get("title"), aliases)
        if kind:
            scored.append({**entry, "match_type": kind})
    order = {"exact": 0, "alias": 1}
    scored.sort(key=lambda e: order.get(e["match_type"], 2))
    return scored[:per_source]