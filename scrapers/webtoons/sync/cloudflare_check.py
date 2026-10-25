import json, subprocess, os, re, tempfile

NEW_EXTS_FILE = os.environ.get('NEW_EXTENSIONS_FILE', '/tmp/keiyoushi_new_extensions.json')
ISSUE_BODY_FILE = os.environ.get('ISSUE_BODY_FILE', '/tmp/keiyoushi_issue_body.md')
HEAD_SHA = os.environ.get('HEAD_SHA', '')
APP_UA = os.environ.get(
    'APP_UA',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
)

CHALLENGE_MARKERS = (
    '/cdn-cgi/challenge-platform/',
    'enable javascript and cookies to continue',
    'window._cf_chl_opt',
    'cf_chl_opt',
    'challenge-form',
    '<title>just a moment...</title>',
)


def classify(url):
    with tempfile.TemporaryDirectory() as tmp:
        headers_file = os.path.join(tmp, 'headers')
        body_file = os.path.join(tmp, 'body')
        try:
            r = subprocess.run(
                [
                    'curl', '-sS', '-L', '-4', '--max-time', '12',
                    '-A', APP_UA,
                    '-D', headers_file, '-o', body_file,
                    '-w', '%{http_code}', url,
                ],
                capture_output=True, text=True, timeout=20,
            )
        except subprocess.TimeoutExpired:
            return 'TIMEOUT'
        except Exception as exc:
            return f'ERREUR: {str(exc)[:60]}'

        code = (r.stdout or '').strip()
        headers = ''
        body = ''
        try:
            with open(headers_file, errors='replace') as f:
                headers = f.read().lower()
        except OSError:
            pass
        try:
            with open(body_file, errors='replace') as f:
                body = f.read(50_000).lower()
        except OSError:
            pass

    if r.returncode == 28:
        return 'TIMEOUT'
    if r.returncode != 0 and code in ('', '000'):
        return f'ERREUR: curl {r.returncode}'

    if code == '451' or re.search(r'error code:?\s*1026', f'{headers}\n{body}'):
        return 'BLOCK IP (451/1026)'
    if 'cf-mitigated: challenge' in headers or any(m in body for m in CHALLENGE_MARKERS):
        return 'CHALLENGE (Cloudflare)'
    if 'cloudflare' in headers or 'cf-ray' in headers:
        if code and not code.startswith('2') and not code.startswith('3'):
            return f'OUI (Cloudflare, HTTP {code})'
        return 'OUI (Cloudflare)'

    server = ''
    for line in headers.split('\n'):
        if line.startswith('server:'):
            server = line.split(':', 1)[1].strip()
    if code and not code.startswith('2') and not code.startswith('3'):
        return f'NON (HTTP {code}{", " + server if server else ""})'
    return f'NON ({server or "accessible"})'

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

    results[ext['key']] = classify(url)

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
