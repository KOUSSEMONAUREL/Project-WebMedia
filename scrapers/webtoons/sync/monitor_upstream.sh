#!/bin/bash
# ============================================================
# Monitor Keiyoushi upstream changes — sans clone local
# Compare le dernier commit connu avec le HEAD remote via API
# Usage: bash monitor_upstream.sh
#   Premier run : enregistre le HEAD actuel seulement
#   Runs suivants: affiche les changements depuis le dernier check
# ============================================================

TSBASE="/home/aurel/CODE/Project-WebMedia/scrapers/webtoons/definitions/webtoons"
LANG_DIRS=("all" "en" "fr")
STATE_FILE="/tmp/keiyoushi_last_commit"
REPO_API="https://api.github.com/repos/keiyoushi/extensions-source"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

# Wrapper curl avec auth GitHub token si disponible
GH_CURL() { curl -sL ${GH_TOKEN:+-H "Authorization: Bearer $GH_TOKEN"} "$@"; }

# Fonction pour extraire les extensions impactées d'un diff GitHub
extract_extensions() {
  python3 -c "
import sys, json
data = json.load(sys.stdin)
files = data.get('files', [])
if not files:
    sys.exit(0)
exts = {}
for f in files:
    import re
    m = re.match(r'^src/(all|en|fr)/([^/]+)/.*\.kt$', f['filename'])
    if m:
        key = f'{m.group(1)}/{m.group(2)}'
        if key not in exts:
            exts[key] = {'lang': m.group(1), 'ext': m.group(2), 'files': [], 'rm_count': 0, 'total': 0}
        exts[key]['files'].append(f['filename'].split('/')[-1])
        exts[key]['total'] += 1
        if f.get('status') == 'removed':
            exts[key]['rm_count'] += 1
for key in sorted(exts):
    e = exts[key]
    flags = ''
    # Tous les fichiers supprimés = extension vraiment supprimée
    if e['rm_count'] > 0 and e['rm_count'] == e['total']:
        flags += ' REMOVED'
    print(f\"{e['lang']}/{e['ext']}\t{' '.join(e['files'])}{flags}\")
"
}

# Récupérer HEAD distant
echo "🔍 Vérification du dépôt keiyoushi/extensions..."
DEFAULT_BRANCH=$(GH_CURL "$REPO_API" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('default_branch','main'))" 2>/dev/null)
HEAD_SHA=$(GH_CURL "$REPO_API/branches/$DEFAULT_BRANCH" | python3 -c "
import sys, json; d=json.load(sys.stdin); print(d['commit']['sha'])
" 2>/dev/null)

if [ -z "$HEAD_SHA" ]; then
  echo -e "${RED}✗ Impossible de contacter GitHub API${NC}"
  echo "  Vérifie ta connexion ou les limites de rate (60 req/h pour non-auth)."
  exit 1
fi

echo -e "${GREEN}✓ HEAD distant: ${HEAD_SHA:0:8}${NC}"

# Lire le dernier commit connu
LAST_CHECKED=""
[ -f "$STATE_FILE" ] && LAST_CHECKED=$(cat "$STATE_FILE")

if [ -z "$LAST_CHECKED" ]; then
  # Premier run
  echo -e "${YELLOW}🆕 Premier check: HEAD = ${HEAD_SHA:0:8} (enregistré)${NC}"
  echo "  Les prochains runs montreront les changements."
  echo "$HEAD_SHA" > "$STATE_FILE"
  exit 0
fi

if [ "$LAST_CHECKED" = "$HEAD_SHA" ]; then
  echo -e "${GREEN}✓ Aucun nouveau changement (toujours ${HEAD_SHA:0:8})${NC}"
  exit 0
fi

echo -e "${YELLOW}⬆ Nouveaux commits: ${LAST_CHECKED:0:8} → ${HEAD_SHA:0:8}${NC}"
echo ""

# Utiliser la GitHub Compare API
COMPARE_JSON=$(GH_CURL "$REPO_API/compare/$LAST_CHECKED...$HEAD_SHA")
CHANGED_EXTS=$(echo "$COMPARE_JSON" | extract_extensions)

if [ -z "$CHANGED_EXTS" ]; then
  echo -e "  Aucun fichier .kt modifié dans src/{all,en,fr}/"
  echo "$HEAD_SHA" > "$STATE_FILE"
  exit 0
fi

TOTAL=0; CRITICAL=0; REMOVED=0; NEW=0; INFO=0

while IFS=$'\t' read -r key files_flags; do
  lang=$(echo "$key" | cut -d/ -f1)
  ext=$(echo "$key" | cut -d/ -f2)
  is_removed=false
  fnames=""
  for token in $files_flags; do
    if [ "$token" = "REMOVED" ]; then is_removed=true; else fnames="$fnames $token"; fi
  done
  fnames=$(echo "$fnames" | xargs)
  ts_file="$TSBASE/$lang/$ext.ts"
  TOTAL=$((TOTAL + 1))

  if $is_removed && [ -f "$ts_file" ]; then
    echo -e "  ${RED}✗ SUPPRIMÉ${NC} $lang/$ext.ts (fichier supprimé upstream)"
    echo "     → Vérifier si le site existe encore, sinon supprimer le .ts"
    REMOVED=$((REMOVED + 1))
    continue
  fi

  if [ ! -f "$ts_file" ]; then
    echo -e "  ${GREEN}➕ NOUVEAU${NC} $lang/$ext/ (pas de .ts correspondant)"
    NEW=$((NEW + 1))
    continue
  fi

  # Déterminer si critique : fichiers qui impacteraient le scraping
  is_critical=0
  for fn in $fnames; do
    base="${fn%.kt}"
    # Fichiers non-critiques
    case "$base" in
      build|*Dto|*Utils|*Manager|*Activity|*Interceptor|*Decoder|*Deobfuscator|*Manifest*)
        continue ;;
    esac
    # Fichiers scraping = critiques
    is_critical=1
    break
  done

  if [ "$is_critical" = "1" ]; then
    CRITICAL=$((CRITICAL + 1))
    echo -e "  ${RED}⚠ CRITIQUE${NC} $lang/$ext.ts"
  else
    INFO=$((INFO + 1))
    echo -e "  ${YELLOW}⚠ INFO${NC} $lang/$ext.ts"
  fi
  echo "     Fichiers modifiés: $fnames"
  echo ""
done <<< "$CHANGED_EXTS"

echo "═══════════════════════════════════════════"
echo -e "  $TOTAL extensions modifiées upstream"
echo -e "  $CRITICAL avec changements scraping (${RED}à revoir${NC})"
[ $REMOVED -gt 0 ] && echo -e "  $REMOVED supprimées upstream (${RED}vérifier${NC})"
[ $NEW -gt 0 ] && echo -e "  $NEW nouvelles extensions (${GREEN}à transpiler si viables${NC})"
[ $INFO -gt 0 ] && echo -e "  $INFO changements non-critiques (refactors internes)"
echo "═══════════════════════════════════════════"

if [ $CRITICAL -gt 0 ]; then
  echo ""
  echo -e "${RED}→ Revoir les CRITIQUE :${NC}"
  echo "  Ouvrir: https://github.com/keiyoushi/extensions-source/compare/$LAST_CHECKED...$HEAD_SHA"
  echo "  ou: https://github.com/keiyoushi/extensions-source/commits/$DEFAULT_BRANCH"
fi
if [ $REMOVED -gt 0 ]; then
  echo -e "${RED}→ Vérifier si le site est mort, supprimer le .ts si oui${NC}"
fi

# Sauvegarder
echo "$HEAD_SHA" > "$STATE_FILE"
