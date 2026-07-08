import sys, json, os, re
from datetime import datetime

TSBASE = os.environ.get('TSBASE', '')
INPUT_FILE = sys.argv[1] if len(sys.argv) > 1 else ''
LAST_SHA = sys.argv[2] if len(sys.argv) > 2 else ''
HEAD_SHA_STR = sys.argv[3] if len(sys.argv) > 3 else ''

if INPUT_FILE:
    with open(INPUT_FILE) as f:
        data = json.load(f)
else:
    data = json.load(sys.stdin)

files = data.get('files', [])

exts = {}
for f in files:
    # Match both .kt and .kts (build.gradle.kts) files
    m = re.match(r'^src/(all|en|fr)/([^/]+)/.*\.kts?$', f['filename'])
    if m:
        key = f'{m.group(1)}/{m.group(2)}'
        if key not in exts:
            exts[key] = {
                'lang': m.group(1),
                'ext': m.group(2),
                'files': [],
                'build_patch': None,
            }
        exts[key]['files'].append(f)

        # Grab build.gradle.kts patch if present
        if f['filename'].endswith('/build.gradle.kts'):
            exts[key]['build_patch'] = f.get('patch', '')

if not exts:
    print("Aucune extension .kt modifiee dans src/{all,en,fr}/")
    if 'GITHUB_STEP_SUMMARY' in os.environ:
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'w') as f:
            f.write("## Resultats du Monitorage Keiyoushi\n\nAucune extension .kt modifiee.\n")
    sys.exit(0)


def is_trivial_patch(patch: str) -> bool | str:
    """Analyse un patch unifie et retourne:
       - False si changement critique
       - Une string descriptive si trivial (ex: 'import shuffle', 'id move')
    """
    if not patch:
        return "binary/no patch"

    added_lines = []
    removed_lines = []

    for line in patch.split('\n'):
        if line.startswith('+') and not line.startswith('+++') and not line.startswith('+package '):
            stripped = line[1:].strip()
            if stripped:
                added_lines.append(stripped)
        elif line.startswith('-') and not line.startswith('---') and not line.startswith('-package '):
            stripped = line[1:].strip()
            if stripped:
                removed_lines.append(stripped)

    if not added_lines and not removed_lines:
        return "changement cosmetique"

    non_import_added = [l for l in added_lines if not l.startswith('import ')]
    non_import_removed = [l for l in removed_lines if not l.startswith('import ')]

    # Only import changes
    if not non_import_added and not non_import_removed:
        return "imports uniquement"

    # Only annotation changes
    all_annotation = all(
        l.startswith('@') or l.startswith('override val ') or l.startswith('abstract override val ')
        for l in non_import_added + non_import_removed
    )
    if all_annotation:
        # Check for id/versionId moves explicitly
        id_changes = [l for l in non_import_added + non_import_removed if 'override val id' in l or 'override val versionId' in l]
        if id_changes:
            return f"deplacement `{'`, `'.join(id_changes)}`"

    # Check if only trivial patterns
    trivial_patterns = [
        'override val ', 'abstract override val ',
        '@Source', '@KeiyoushiSource',
        'companion object',
        'private const val',
        'import ', 'package ',
    ]

    all_trivial = True
    for l in non_import_added + non_import_removed:
        if not any(l.startswith(p) or l.startswith(f'    {p}') or l.startswith(f'        {p}')
                   for p in trivial_patterns):
            all_trivial = False
            break

    if all_trivial:
        return "declarations uniquement (annotations, constantes)"

    return False


def summarize_patch(patch: str) -> str:
    """Genere un resume lisible du patch."""
    if not patch:
        return "fichier binaire"

    added = []
    removed = []
    for line in patch.split('\n'):
        if line.startswith('+') and not line.startswith('+++'):
            added.append(line[1:].strip())
        elif line.startswith('-') and not line.startswith('---'):
            removed.append(line[1:].strip())

    parts = []
    if added:
        # Find significant additions (non-import)
        sig = [l for l in added if not l.startswith('import ') and not l.startswith('@') and l]
        if sig:
            # Show first few significant lines
            short = []
            for s in sig[:3]:
                if len(s) > 60:
                    s = s[:57] + '...'
                short.append(f"`{s.strip()}`")
            parts.append(f"+{len(sig)} lignes: {', '.join(short)}")
            if len(sig) > 3:
                parts[-1] += f" et {len(sig)-3} autre(s)"
        else:
            imports = [l for l in added if l.startswith('import ')]
            if imports:
                parts.append(f"+{len(imports)} import(s)")

    if removed:
        sig = [l for l in removed if not l.startswith('import ') and not l.startswith('@') and l]
        if sig:
            short = []
            for s in sig[:3]:
                if len(s) > 60:
                    s = s[:57] + '...'
                short.append(f"`{s.strip()}`")
            parts.append(f"-{len(sig)} lignes: {', '.join(short)}")
            if len(sig) > 3:
                parts[-1] += f" et {len(sig)-3} autre(s)"
        else:
            imports = [l for l in removed if l.startswith('import ')]
            if imports:
                parts.append(f"-{len(imports)} import(s)")

    return '; '.join(parts) if parts else "modifications mineures"


def extract_baseurls_from_build(content: str) -> list[str]:
    """Extract base URLs from build.gradle.kts content (both old and new DSL format)."""
    urls = []
    lines = content.split('\n')
    in_baseurl_block = False
    for line in lines:
        # Old format: baseUrl = "https://..."
        m = re.search(r'baseUrl\s*=\s*"([^"]+)"', line)
        if m:
            urls.append(m.group(1))
            continue
        # Detect new DSL block start
        if re.search(r'baseUrl\s*\{', line):
            in_baseurl_block = True
            continue
        if in_baseurl_block:
            if line.strip() == '}':
                in_baseurl_block = False
                continue
            # Inside baseUrl block: mirrors("..."), custom("..."), or just "..."
            m = re.search(r'"(https?://[^"]+)"', line)
            if m:
                urls.append(m.group(1))
    return urls


def classify_new_extension_build(build_patch: str) -> dict:
    """Classify a new extension's build.gradle.kts for description."""
    info = {'baseUrl': None, 'type': 'inconnu'}
    if not build_patch:
        return info

    # For patches, reconstruct the full + lines to get actual content
    full_content = []
    for line in build_patch.split('\n'):
        if line.startswith('+') and not line.startswith('+++'):
            full_content.append(line[1:])
        elif not line.startswith('-') and not line.startswith('@@') and not line.startswith('---') and not line.startswith('diff '):
            full_content.append(line)

    content = '\n'.join(full_content)

    # Extract name
    for line in content.split('\n'):
        m = re.search(r'name\s*=\s*"([^"]+)"', line)
        if m:
            info['type'] = m.group(1)
            break

    # Extract base URLs
    urls = extract_baseurls_from_build(content)
    if urls:
        info['baseUrl'] = urls[0]
        info['allUrls'] = urls

    return info


TOTAL = CRITICAL = REMOVED = NEW = INFO = BUILD_COUNT = 0
report = []
new_extensions_details = []

for key in sorted(exts):
    e = exts[key]
    ts_path = os.path.join(TSBASE, e['lang'], f"{e['ext']}.ts")
    TOTAL += 1
    ext_has_local_ts = os.path.exists(ts_path)

    all_rm = all(f.get('status') == 'removed' for f in e['files'])
    is_new = not ext_has_local_ts and not all_rm
    # Determine if this extension was truly added upstream (all files 'added')
    all_added = all(f.get('status') == 'added' for f in e['files'])

    if all_rm and ext_has_local_ts:
        REMOVED += 1
        report.append(('REMOVED', key, 'Extension supprimee upstream'))
        continue

    if is_new:
        NEW += 1
        build_info = classify_new_extension_build(e.get('build_patch', ''))

        if all_added:
            desc = "NOUVELLE upstream"
        else:
            desc = "Existante upstream (pas de .ts)"

        # Try to determine type from files
        base_url = build_info.get('baseUrl')
        if base_url:
            if '127.0.0.1' in base_url or 'localhost' in base_url:
                desc += " - Serveur local"
            else:
                desc += " - Site web"
        url_display = base_url or ''

        report.append(('NEW', key, desc, url_display))
        new_extensions_details.append({
            'key': key,
            'baseUrl': base_url,
            'lang': e['lang'],
        })
        continue

    # We have local .ts - analyze changes
    if not ext_has_local_ts:
        # All files removed and no local .ts - ignore
        continue

    # Determine if only build.gradle.kts changed
    kt_files_changed = [f for f in e['files'] if f['filename'].endswith('.kt') and 'build.gradle' not in f['filename']]
    only_build = len(kt_files_changed) == 0

    if only_build:
        BUILD_COUNT += 1
        desc = summarize_patch(e['files'][0].get('patch', ''))
        report.append(('BUILD', key, desc))
        continue

    # Analyze actual .kt patches
    critical_files = []
    info_changes = []
    all_trivial_flag = True

    for f in kt_files_changed:
        fn = f['filename'].split('/')[-1]
        patch = f.get('patch', '')
        trivial_result = is_trivial_patch(patch)

        if trivial_result is False:
            all_trivial_flag = False
            summary = summarize_patch(patch)
            critical_files.append(f"{fn}: {summary}")
        else:
            info_changes.append(f"{fn}: {trivial_result if isinstance(trivial_result, str) else summarize_patch(patch)}")

    if not all_trivial_flag:
        CRITICAL += 1
        change_desc = '; '.join(critical_files)
        if info_changes:
            change_desc += f" (+infos: {'; '.join(info_changes)})"
        report.append(('CRITICAL', key, change_desc))
    else:
        INFO += 1
        change_desc = '; '.join(info_changes) if info_changes else "changements mineurs"
        report.append(('INFO', key, change_desc))


# Write GITHUB_STEP_SUMMARY
if 'GITHUB_STEP_SUMMARY' in os.environ:
    today = datetime.now().strftime('%d/%m/%Y') if LAST_SHA and HEAD_SHA_STR else ''
    with open(os.environ['GITHUB_STEP_SUMMARY'], 'w') as f:
        f.write(f"## Changements upstream keiyoushi ({today or 'N/A'})\n\n")
        if LAST_SHA and HEAD_SHA_STR:
            f.write(f"**Compare**: https://github.com/keiyoushi/extensions-source/compare/{LAST_SHA}...{HEAD_SHA_STR}\n\n")
        f.write("| Extension | Statut | Changement | URL / Note |\n|---|---|---|---|\n")
        for entry in report:
            status = entry[1] if len(entry) > 1 else ''
            detail = entry[2] if len(entry) > 2 else ''
            url_part = entry[3] if len(entry) > 3 else ''
            badge_map = {
                'CRITICAL': ':red_circle: CRITIQUE',
                'REMOVED': ':wastebasket: SUPPRIME',
                'NEW': ':large_green_circle: NOUVEAU',
                'INFO': ':large_yellow_circle: INFO',
                'BUILD': ':building_construction: BUILD',
            }
            badge = badge_map.get(entry[0], entry[0])
            f.write(f"| {badge} | {status} | {detail} | {url_part} |\n")
        f.write("\n### Resume\n\n")
        f.write(f"- **Total modifiees**: {TOTAL}\n")
        f.write(f"- **:red_circle: Critiques**: {CRITICAL}\n")
        f.write(f"- **:wastebasket: Supprimees**: {REMOVED}\n")
        f.write(f"- **:large_green_circle: Nouvelles**: {NEW}\n")
        f.write(f"- **:large_yellow_circle: Informatives**: {INFO}\n")
        f.write(f"- **:building_construction: Build uniquement**: {BUILD_COUNT}\n")

# Write GITHUB_ENV (backward compatible)
if 'GITHUB_ENV' in os.environ:
    with open(os.environ['GITHUB_ENV'], 'a') as f:
        f.write(f"TOTAL_CHANGED={TOTAL}\n")
        f.write(f"CRITICAL_CHANGED={CRITICAL}\n")
        f.write(f"REMOVED_CHANGED={REMOVED}\n")
        f.write(f"NEW_CHANGED={NEW}\n")
        f.write(f"INFO_CHANGED={INFO}\n")
        f.write(f"BUILD_CHANGED={BUILD_COUNT}\n")

# Write new extensions details for Cloudflare check
if new_extensions_details:
    details_path = os.environ.get('NEW_EXTENSIONS_FILE', '/tmp/keiyoushi_new_extensions.json')
    with open(details_path, 'w') as f:
        json.dump(new_extensions_details, f, indent=2)

# Write report markdown for issue body (without Cloudflare, added later by workflow)
issue_body_path = os.environ.get('ISSUE_BODY_FILE', '/tmp/keiyoushi_issue_body.md')
today = datetime.now().strftime('%d/%m/%Y') if LAST_SHA and HEAD_SHA_STR else ''
with open(issue_body_path, 'w') as f:
    f.write(f"## Changements upstream keiyoushi ({today or 'N/A'})\n\n")
    if LAST_SHA and HEAD_SHA_STR:
        f.write(f"**Compare**: https://github.com/keiyoushi/extensions-source/compare/{LAST_SHA}...{HEAD_SHA_STR}\n\n")

    f.write("| Extension | Statut | Changement | URL | Cloudflare |\n|---|---|---|---|---|\n")
    for entry in report:
        status = entry[1] if len(entry) > 1 else ''
        detail = entry[2] if len(entry) > 2 else ''
        url_part = entry[3] if len(entry) > 3 else ''
        badge_map = {
            'CRITICAL': ':red_circle: CRITIQUE',
            'REMOVED': ':wastebasket: SUPPRIME',
            'NEW': ':large_green_circle: NOUVEAU',
            'INFO': ':large_yellow_circle: INFO',
            'BUILD': ':building_construction: BUILD',
        }
        badge = badge_map.get(entry[0], entry[0])
        # Cloudflare column filled later by workflow (also for missing URLs that might be fetchable)
        is_new_web = entry[0] == 'NEW' and not url_part.startswith('http://127.0.0.1') and not url_part.startswith('http://localhost') and not url_part.startswith('https://127.0.0.1')
        cf_status = '_(verification...)_' if is_new_web else '-'
        f.write(f"| {badge} | {status} | {detail} | {url_part or '-'} | {cf_status} |\n")

    f.write("\n### Resume\n\n")
    f.write(f"- **Total modifiees**: {TOTAL}\n")
    f.write(f"- **:red_circle: Critiques**: {CRITICAL}\n")
    f.write(f"- **:wastebasket: Supprimees**: {REMOVED}\n")
    f.write(f"- **:large_green_circle: Nouvelles**: {NEW}\n")
    f.write(f"- **:large_yellow_circle: Informatives**: {INFO}\n")
    f.write(f"- **:building_construction: Build uniquement**: {BUILD_COUNT}\n\n")

    f.write(f"> Consulte le workflow run #{os.environ.get('GITHUB_RUN_ID', 'N/A')} pour le detail complet.\n")

# Console output
badge_map = {
    'CRITICAL': 'CRITIQUE',
    'REMOVED': 'SUPPRIME',
    'NEW': 'NOUVEAU',
    'INFO': 'INFO',
    'BUILD': 'BUILD',
}
print(f"\nTotal: {TOTAL} | Critiques: {CRITICAL} | Supprimees: {REMOVED} | Nouvelles: {NEW} | Infos: {INFO} | Build: {BUILD_COUNT}")
for entry in report:
    badge = badge_map.get(entry[0], entry[0])
    status = entry[1] if len(entry) > 1 else ''
    detail = entry[2] if len(entry) > 2 else ''
    url_part = entry[3] if len(entry) > 3 else ''
    url_str = f" [{url_part}]" if url_part else ''
    print(f"  [{badge}] {status}: {detail}{url_str}")
