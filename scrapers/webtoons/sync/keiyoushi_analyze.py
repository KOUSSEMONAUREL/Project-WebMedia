import sys, json, os

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
    import re
    m = re.match(r'^src/(all|en|fr)/([^/]+)/.*\.kt$', f['filename'])
    if m:
        key = f'{m.group(1)}/{m.group(2)}'
        if key not in exts:
            exts[key] = {'lang': m.group(1), 'ext': m.group(2), 'files': [], 'rm_count': 0, 'total': 0}
        exts[key]['files'].append(f['filename'])
        exts[key]['total'] += 1
        if f.get('status') == 'removed':
            exts[key]['rm_count'] += 1

if not exts:
    print("Aucune extension .kt modifiée dans src/{all,en,fr}/")
    sys.exit(0)

TOTAL = CRITICAL = REMOVED = NEW = INFO = 0
report = []

for key in sorted(exts):
    e = exts[key]
    ts_path = os.path.join(TSBASE, e['lang'], f"{e['ext']}.ts")
    TOTAL += 1

    all_rm = e['rm_count'] > 0 and e['rm_count'] == e['total']
    if all_rm and os.path.exists(ts_path):
        REMOVED += 1
        report.append(('REMOVED', f"{e['lang']}/{e['ext']}.ts", 'Extension supprimée upstream'))
        continue

    if not os.path.exists(ts_path):
        NEW += 1
        report.append(('NEW', f"{e['lang']}/{e['ext']}/", 'Nouvelle extension (pas de .ts correspondant)'))
        continue

    crit_files = []
    for fp in e['files']:
        fn = fp.split('/')[-1]
        base = fn.replace('.kt', '')
        if base == 'build' or base.endswith(('Dto','Utils','Manager','Activity','Interceptor','Decoder','Deobfuscator')) or 'Manifest' in base:
            continue
        crit_files.append(fn)

    if crit_files:
        CRITICAL += 1
        report.append(('CRITICAL', f"{e['lang']}/{e['ext']}.ts", ', '.join(crit_files)))
    else:
        INFO += 1
        report.append(('INFO', f"{e['lang']}/{e['ext']}.ts", ', '.join(f.split('/')[-1] for f in e['files'])))

with open(os.environ['GITHUB_STEP_SUMMARY'], 'w') as f:
    f.write("## Résultats du Monitorage Keiyoushi\n\n")
    if LAST_SHA and HEAD_SHA_STR:
        f.write(f"**Compare**: https://github.com/keiyoushi/extensions-source/compare/{LAST_SHA}...{HEAD_SHA_STR}\n\n")
    f.write("| Statut | Extension | Détail |\n|---|---|---|\n")
    for status, name, detail in report:
        badge = {
            'CRITICAL': '🔴 CRITIQUE',
            'REMOVED': '🗑️ SUPPRIMÉ',
            'NEW': '🟢 NOUVEAU',
            'INFO': '🟡 INFO'
        }.get(status, status)
        f.write(f"| {badge} | {name} | {detail} |\n")
    f.write("\n### Résumé\n\n")
    f.write(f"- **Total modifiées**: {TOTAL}\n")
    f.write(f"- **🔴 Critiques**: {CRITICAL}\n")
    f.write(f"- **🗑️ Supprimées**: {REMOVED}\n")
    f.write(f"- **🟢 Nouvelles**: {NEW}\n")
    f.write(f"- **🟡 Informatives**: {INFO}\n")

with open(os.environ['GITHUB_ENV'], 'a') as f:
    f.write(f"TOTAL_CHANGED={TOTAL}\n")
    f.write(f"CRITICAL_CHANGED={CRITICAL}\n")
    f.write(f"REMOVED_CHANGED={REMOVED}\n")
    f.write(f"NEW_CHANGED={NEW}\n")
    f.write(f"INFO_CHANGED={INFO}\n")

print(f"\nTotal: {TOTAL} | Critiques: {CRITICAL} | Supprimées: {REMOVED} | Nouvelles: {NEW} | Infos: {INFO}")
