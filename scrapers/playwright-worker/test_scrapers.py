import os, sys, time, json, re, requests
from lxml import html

GAME_SOURCES = [
    ("steamunlocked.org", "https://steamunlocked.org/?s=", "Hollow Knight"),
    ("fitgirl-repacks.site", "https://fitgirl-repacks.site/?s=", "Hollow Knight"),
    ("gamedrive.org", "https://gamedrive.org/?s=", "Hollow Knight"),
    ("elamigos.site", "https://elamigos.site/?q=", "Hollow Knight"),
    ("romspure.cc", "https://romspure.cc/?s=", "Super Mario"),
    ("cfinder.xyz", "https://cfinder.xyz/jeux.php?q=", "Elden Ring"),
    ("emulatorgamesx.net", "https://www.emulatorgamesx.net/?s=", "Super Mario"),
    ("romsfun.com", "https://romsfun.com/?s=", "Pokemon"),
    ("games4u.org", "https://games4u.org/?s=", "Elden Ring"),
    ("steamrip.com", "https://steamrip.com/?s=", "Hollow Knight"),
]

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

session = requests.Session()
session.headers.update({"User-Agent": UA})

def css_attr(page_text, selector, attr="href"):
    tree = html.fromstring(page_text)
    els = tree.cssselect(selector)
    vals = []
    for el in els:
        v = el.get(attr)
        if v:
            vals.append(v.strip())
    return vals

def test_game(page_text, url, game_name):
    found = []
    def add_link(u, source):
        found.append({"url": u, "source_site": source})

    if "fitgirl-repacks.site" in url:
        game_links = css_attr(page_text, 'article h1.entry-title a', 'href')
        game_links = [l for l in game_links if l.endswith('/') and "updates-digest" not in l and "category" not in l and "#respond" not in l]
        for l in list(set(game_links)):
            add_link(l, "fitgirl-repacks.site")
        return found

    if "steamunlocked.org" in url:
        game_links = css_attr(page_text, 'div.cover-item-title a', 'href')
        game_links = [l for l in game_links if "free-download" in l.lower()]
        for l in list(set(game_links)):
            add_link(l, "steamunlocked.org")
        return found

    if "gamedrive.org" in url:
        game_links = css_attr(page_text, 'h2.entry-title a', 'href')
        game_links = [l for l in game_links if "gamedrive.org" in l]
        if not game_links:
            game_links = css_attr(page_text, 'article h2.entry-title a', 'href')
        for l in list(set(game_links)):
            add_link(l, "gamedrive.org")
        return found

    if "cfinder.xyz" in url:
        game_links = css_attr(page_text, 'div.card h2 a, div.card__content a', 'href')
        game_links = [l for l in game_links if "/jeux/" in l.lower() or "/games/" in l.lower()]
        for l in list(set(game_links)):
            full = l if l.startswith('http') else f"https://cfinder.xyz{l}"
            add_link(full, "cfinder.xyz")
        return found

    if "elamigos.site" in url:
        all_links = css_attr(page_text, 'a', 'href')
        game_links = [l for l in all_links if "data/" in l.lower()]
        if game_name:
            slug = re.sub(r'[^a-z0-9\s]', '', game_name.lower()).strip()
            slug_u = slug.replace(' ', '_')
            filtered = []
            for l in game_links:
                clean = re.sub(r'[^a-z0-9_]', '', l.lower().replace(' ', '_'))
                if slug_u in clean:
                    filtered.append(l)
            game_links = filtered[:10]
        else:
            game_links = list(set(game_links))[:5]
        for l in game_links:
            full = l if l.startswith('http') else f"https://elamigos.site/{l}"
            add_link(full, "elamigos.site")
        return found

    if "romspure.cc" in url:
        game_links = css_attr(page_text, 'article a', 'href')
        game_links = [l for l in game_links if "/roms/" in l.lower() or "/hacks/" in l.lower()]
        for l in list(set(game_links)):
            add_link(l, "romspure.cc")
        return found

    if "emulatorgamesx.net" in url:
        game_links = css_attr(page_text, 'article a', 'href')
        game_links = [l for l in game_links if "/roms/" in l.lower()]
        for l in list(set(game_links)):
            add_link(l, "emulatorgamesx.net")
        return found

    if "romsfun.com" in url:
        all_links = css_attr(page_text, 'a', 'href')
        game_links = [l for l in all_links if "/roms/" in l.lower() and ".html" in l.lower()]
        for l in list(set(game_links)):
            add_link(l, "romsfun.com")
        return found

    if "games4u.org" in url:
        game_links = css_attr(page_text, 'div.blog-content a', 'href')
        game_links = [l for l in game_links if "games4u.org" in l and "?" not in l and "page" not in l and "#" not in l and l.count('/') >= 3 and "/category/" not in l and "/author/" not in l and "/tag/" not in l and "/wp-" not in l]
        for l in list(set(game_links)):
            add_link(l, "games4u.org")
        return found

    if "steamrip.com" in url:
        game_links = css_attr(page_text, 'div#masonry-grid h2.thumb-title a, div#masonry-grid a', 'href')
        game_links = [l for l in game_links if l and not l.startswith('#') and not l.startswith('http') and not l.startswith('javascript')]
        for l in list(set(game_links)):
            full = f"https://steamrip.com/{l}" if not l.startswith('http') else l
            add_link(full, "steamrip.com")
        return found

    return found

def verify_url(u):
    try:
        r = session.head(u, timeout=8, allow_redirects=True)
        return r.status_code
    except:
        try:
            r = session.get(u, timeout=8, stream=True)
            return r.status_code
        except:
            return None

passed = 0
failed = 0
for site_name, base_url, game_name in GAME_SOURCES:
    search_url = base_url + game_name.replace(" ", "+")
    print(f"\n{'='*60}")
    print(f"[{site_name}] Searching: {game_name}")
    print(f"  URL: {search_url}")
    try:
        kwargs = {"timeout": 20}
        if site_name == "steamunlocked.org":
            kwargs["verify"] = False
        r = session.get(search_url, **kwargs)
        status = r.status_code
        page_text = r.text
        if status != 200:
            print(f"  FAIL: HTTP {status}")
            failed += 1
            continue
        links = test_game(page_text, search_url, game_name)
        print(f"  Found: {len(links)} link(s)")
        if not links:
            print(f"  FAIL: No links returned")
            failed += 1
            continue
        ok_count = 0
        for link in links[:5]:
            u = link["url"]
            code = verify_url(u)
            code_str = str(code) if code else "ERR"
            status_icon = "OK" if code and code < 400 else "BAD" if code else "ERR"
            print(f"    [{status_icon}:{code_str}] {u[:100]}")
            if code and code < 400:
                ok_count += 1
        if ok_count >= min(len(links[:5]), 1):
            print(f"  PASS ({ok_count}/{min(len(links),5)} verified)")
            passed += 1
        else:
            print(f"  FAIL: {ok_count}/{min(len(links),5)} verified OK")
            failed += 1
    except Exception as e:
        print(f"  EXCEPTION: {e}")
        failed += 1

print(f"\n{'='*60}")
print(f"RESULTS: {passed}/{passed+failed} passed, {failed} failed")
sys.exit(0 if failed == 0 else 1)
