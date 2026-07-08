import json, subprocess, os, re

NEW_EXTS_FILE = os.environ.get('NEW_EXTENSIONS_FILE', '/tmp/keiyoushi_new_extensions.json')
ISSUE_BODY_FILE = os.environ.get('ISSUE_BODY_FILE', '/tmp/keiyoushi_issue_body.md')
HEAD_SHA = os.environ.get('HEAD_SHA', '')

if not os.path.exists(NEW_EXTS_FILE):
    print("No new extensions file found")
    exit(0)

with open(NEW_EXTS_FILE) as f:
    exts = json.load(f)

with open(ISSUE_BODY_FILE) as f:
    body = f.read()

UPSTREAM_RAW = f'https://raw.githubusercontent.com/keiyoushi/extensions-source/{HEAD_SHA}'

results = {}
for ext in exts:
    url = ext.get('baseUrl')

    if not url:
        lang = ext.get('lang', 'all')
        ext_name = ext['key'].split('/')[1]
        build_url = f'{UPSTREAM_RAW}/src/{lang}/{ext_name}/build.gradle.kts'
        try:
            r = subprocess.run(
                ['curl', '-sL', '--max-time', '8', build_url],
                capture_output=True, text=True, timeout=12
            )
            if r.returncode == 0:
                content = r.stdout
                for line in content.split('\n'):
                    m = re.search(r'baseUrl\s*=\s*"([^"]+)"', line)
                    if m:
                        url = m.group(1)
                        ext['baseUrl'] = url
                        break
                if not url:
                    in_block = False
                    for line in content.split('\n'):
                        if re.search(r'baseUrl\s*\{', line):
                            in_block = True
                            continue
                        if in_block:
                            if line.strip() == '}':
                                break
                            m = re.search(r'"(https?://[^"]+)"', line)
                            if m:
                                url = m.group(1)
                                ext['baseUrl'] = url
                                break
        except Exception:
            pass

    if not url:
        results[ext['key']] = 'URL inconnue'
        continue

    if '127.0.0.1' in url or 'localhost' in url:
        results[ext['key']] = 'NON (local)'
        continue

    if not url.startswith('http'):
        url = 'https://' + url

    try:
        r = subprocess.run(
            ['curl', '-sI', '--max-time', '10', url],
            capture_output=True, text=True, timeout=15
        )
        headers = r.stdout.lower()
        if 'cloudflare' in headers or 'cf-ray' in headers:
            results[ext['key']] = 'OUI (Cloudflare)'
        else:
            server = ''
            for line in r.stdout.split('\n'):
                if line.lower().startswith('server:'):
                    server = line.split(':', 1)[1].strip()
                    break
            results[ext['key']] = f'NON ({server or "accessible"})'
    except subprocess.TimeoutExpired:
        results[ext['key']] = 'TIMEOUT'
    except Exception as exc:
        results[ext['key']] = f'ERREUR: {str(exc)[:60]}'

    print(f'{ext["key"]}: {results[ext["key"]]}')

lines = body.split('\n')
for i, line in enumerate(lines):
    for key, status in results.items():
        if key in line and '_(verification...)_' in line:
            new_url = None
            for ext in exts:
                if ext['key'] == key:
                    new_url = ext.get('baseUrl')
                    break
            if new_url and '| - | _(verification...)_' in line:
                lines[i] = line.replace('| - | _(verification...)_', f'| {new_url} | {status}')
            else:
                lines[i] = line.replace('_(verification...)_', status)
            break
body = '\n'.join(lines)

with open(ISSUE_BODY_FILE, 'w') as f:
    f.write(body)
