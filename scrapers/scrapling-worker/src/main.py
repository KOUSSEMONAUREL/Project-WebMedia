import os
import time
import json
import threading
import requests
import re
import subprocess
import sys
import glob
from dotenv import load_dotenv
from flask import Flask, jsonify
from scrapling import Fetcher
from logger import Log
from title_match import match_title, pick, search_query, strip_edition

load_dotenv()

app = Flask(__name__)
@app.route('/health')
@app.route('/')
def health():
    return jsonify({"status": "ok", "worker": "scrapling-worker"})

def run_health_server():
    app.run(host='0.0.0.0', port=8080)

# Mods et heritages dont la fiche sur la source porte le nom du jeu de base.
# Cle = slug du media. Le lien sera accepte en "alias" et affiché comme tel.
GAME_ALIASES = {
    # "terraria-calamity-mod": ["Terraria"],
}


def clean_search_title(game_name):
    """Normalise le titre pour la recherche.

    Retire les suffixes d'edition/plateforme (ex: "Guilty Gear: Strive -
    Nintendo Switch Edition" -> "Guilty Gear Strive") qui ne matchent aucun
    resultat sur les sites de recherche.
    """
    title = re.sub(r'\s*[-–—]\s*.*$', '', game_name.strip())
    title = title.replace(':', '')
    return title.strip() or game_name.strip()


# --- Requete site: source unique de verite -------------------------------
# Le worker et le moniteur (src/scraper_verify.py) doivent interroger les
# sites de facon identique. Ils divergeaient: le moniteur forcait
# impersonate="chrome" + stealthy_headers + verify=False sur les 10 sites, la
# production un simple en-tete User-Agent avec verify=False seulement pour
# steamunlocked.org. Un site pouvait donc etre vert au moniteur et casse en
# production, et un certificat invalide passerait au moniteur alors que la
# production le refuse.
DEFAULT_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
FETCH_TIMEOUT = 30
# Certificat invalide connu: on desactive la verification pour ce seul site.
SKIP_TLS_VERIFY = {"steamunlocked.org"}


def fetch_site_page(site_name: str, url: str):
    """Interroge un site avec exactement la configuration du worker."""
    kwargs = {
        "headers": {"User-Agent": DEFAULT_UA},
        "timeout": FETCH_TIMEOUT,
    }
    if site_name in SKIP_TLS_VERIFY:
        kwargs["verify"] = False
    return Fetcher.get(url, **kwargs)


def extract_game_links(page, url, game_name=None):
    found = []

    page_title_match = re.search(r'<title>(.*?)</title>', page.text, re.IGNORECASE | re.DOTALL)
    page_title = page_title_match.group(1).strip() if page_title_match else ""
    final_page_url = getattr(page, 'url', url)

    def add_link(u, source, ltype, valid_button=False, title=None):
        """`title` est le titre de la fiche liee. Sans lui le lien ne peut pas etre
        rattache au jeu demande, donc il est marque pour elimination plus bas."""
        found.append({
            "url": u,
            "final_url": u if u.startswith('http') or u.startswith('magnet:') else final_page_url,
            "source_site": source,
            "player_host": ltype,
            "link_type": ltype,
            "page_title": page_title,
            "link_title": title,
            "http_status": getattr(page, 'status', 200),
            "valid_download_button": valid_button,
            "scraped_at": int(time.time())
        })

    def collect_nodes(selectors):
        """Recupere (href, titre) pour chaque ancre. Le titre est indispensable:
        sans lui on ne peut pas verifier que le lien correspond au jeu cherche,
        et c'est exactement ce qui faisait attacher des liens d'autres jeux."""
        pairs = []
        for sel in selectors:
            try:
                for a in page.css(sel):
                    href = a.attrib.get('href')
                    if not href:
                        continue
                    title = (a.text or '').strip() or (a.attrib.get('title') or '').strip()
                    pairs.append((href, title))
            except Exception:
                continue
        return pairs

    if "fitgirl-repacks.site" in url:
        seen = set()
        for href, title in collect_nodes(['article h1.entry-title a']):
            if not href.endswith('/') or "updates-digest" in href or "updates-list" in href or "category" in href or "#respond" in href:
                continue
            if href in seen:
                continue
            seen.add(href)
            add_link(href, "fitgirl-repacks.site", "page_selection", True, title)
        return found

    if "steamunlocked.org" in url:
        game_links = page.css('a.su-cat__card::attr(href)').getall()
        if not game_links:
            game_links = page.css('div.cover-item-title a::attr(href)').getall()
        game_links = list(set(l for l in game_links if "free-download" in (l or '').lower()))
        for l in game_links:
            add_link(l, "steamunlocked.org", "page_selection", True)
        return found

    if "gamedrive.org" in url:
        game_links = page.css('h2.entry-title a::attr(href)').getall()
        game_links = list(set(l for l in game_links if "gamedrive.org" in l))
        if not game_links:
            game_links = page.css('article h2.entry-title a::attr(href)').getall()
            game_links = list(set(l for l in game_links))
        for l in game_links:
            add_link(l, "gamedrive.org", "page_selection", True)
        return found

    if "cfinder.xyz" in url or "directory.cfinder.xyz" in url:
        # Le site est passe sous SvelteKit : la recherche est une API JSON
        # (GET /api/cracks/search/<titre>) et les fiches jeux sont sur /jeux/<slug>.
        try:
            payload = getattr(page, 'body', None) or page.text
            data = json.loads(payload)
            for item in (data.get("data") or []):
                slug = (item.get("slug") or "").strip()
                if not slug:
                    continue
                add_link(f"https://cfinder.xyz/jeux/{slug}", "cfinder.xyz", "page_selection", True,
                         item.get("title") or "")
            if found:
                return found
        except (ValueError, AttributeError):
            pass
        seen = set()
        for href, title in collect_nodes(['div.card h2 a', 'div.card__content a']):
            if "/jeux/" not in (href or '').lower() and "/games/" not in (href or '').lower():
                continue
            if href in seen:
                continue
            seen.add(href)
            full_url = href if href.startswith('http') else f"https://cfinder.xyz{href}"
            add_link(full_url, "cfinder.xyz", "page_selection", True, title)
        return found

    if "elamigos.site" in url:
        all_links = page.css('a::attr(href)').getall()
        game_links = [l for l in all_links if "data/" in (l or '').lower()]
        if game_name:
            slug = re.sub(r'[^a-z0-9\s]', '', game_name.lower()).strip()
            slug_underscored = slug.replace(' ', '_')
            filtered = []
            for l in game_links:
                clean = re.sub(r'[^a-z0-9_]', '', l.lower().replace(' ', '_'))
                if slug_underscored in clean:
                    filtered.append(l)
            pairs = [(l, None) for l in filtered[:10]]
        else:
            pairs = [(l, None) for l in list(set(game_links))[:5]]
        for l, t in pairs:
            full_url = l if l.startswith('http') else f"https://elamigos.site/{l}"
            add_link(full_url, "elamigos.site", "page_selection", True, t)
        return found

    if "romspure.cc" in url:
        seen = set()
        for href, title in collect_nodes(['article a']):
            low = (href or '').lower()
            if "/roms/" not in low and "/hacks/" not in low:
                continue
            if href in seen:
                continue
            seen.add(href)
            add_link(href, "romspure.cc", "page_selection", True, title)
        return found

    if "emulatorgamesx.net" in url:
        seen = set()
        for href, title in collect_nodes(['article a']):
            if "/roms/" not in (href or '').lower() or href in seen:
                continue
            seen.add(href)
            add_link(href, "emulatorgamesx.net", "page_selection", True, title)
        return found

    if "romsfun.com" in url:
        seen = set()
        for href, title in collect_nodes(['a']):
            low = (href or '').lower()
            if "/roms/" not in low or ".html" not in low or href in seen:
                continue
            seen.add(href)
            add_link(href, "romsfun.com", "page_selection", True, title)
        return found

    if "games4u.org" in url:
        seen = set()
        for href, title in collect_nodes(['div.blog-content a']):
            low = (href or '').lower()
            if "?" in href or "#" in href or href.count('/') < 3:
                continue
            if any(b in low for b in ("/category/", "/author/", "/tag/", "/wp-")) or href in seen:
                continue
            seen.add(href)
            add_link(href, "games4u.org", "page_selection", True, title)
        return found

    if "steamrip.com" in url:
        seen = set()
        for href, title in collect_nodes(['div#masonry-grid h2.thumb-title a', 'div#masonry-grid a']):
            if not href or href.startswith(('#', 'http', 'javascript', '/')) or href in seen:
                continue
            seen.add(href)
            add_link(f"https://steamrip.com/{href}", "steamrip.com", "page_selection", True, title)
        return found

    return found

def process_jobs():
    supabase_url = os.environ.get("SUPABASE_DATABASE_URL", "")
    internal_api_url = os.environ.get("INTERNAL_API_URL", "")
    internal_api_key = os.environ.get("INTERNAL_API_KEY", "")

    log = Log("Playwright Worker", "one-shot")
    log.header()

    if not supabase_url:
        log.error("SUPABASE_DATABASE_URL is not set")
        return

    try:
        import psycopg2
        conn = psycopg2.connect(supabase_url)
        conn.autocommit = False
        log.success("Connected to Supabase queue")
    except Exception as e:
        log.error(f"Cannot connect to Supabase: {e}")
        return

    GAME_SOURCES = [
        ("steamunlocked.org", "https://steamunlocked.org/?s="),
        ("fitgirl-repacks.site", "https://fitgirl-repacks.site/?s="),
        ("gamedrive.org", "https://gamedrive.org/?s="),
        ("elamigos.site", "https://elamigos.site/?q="),
        ("romspure.cc", "https://romspure.cc/?s="),
        ("cfinder.xyz", "https://cfinder.xyz/api/cracks/search/"),
        ("emulatorgamesx.net", "https://www.emulatorgamesx.net/?s="),
        ("romsfun.com", "https://romsfun.com/?s="),
        ("games4u.org", "https://games4u.org/?s="),
        ("steamrip.com", "https://steamrip.com/?s="),
    ]

    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM scraping_jobs WHERE status = 'pending' AND worker_type = 'playwright'")
    row = cur.fetchone()
    total = row[0] if row else 0
    if total == 0:
        log.skip("No pending playwright jobs")
        conn.close()
        log.summary(0, 0)
        return
    log.info(f"{total} job(s) pending")

    jobs_processed = 0
    errors = 0
    no_match_jobs = 0
    max_jobs = 30
    start_time = time.time()
    max_duration = 15 * 60

    while (time.time() - start_time) < max_duration and jobs_processed < max_jobs:
        job_id = None
        try:
            cur = conn.cursor()
            cur.execute("""
                UPDATE scraping_jobs 
                SET status = 'processing', locked_at = NOW(), attempts = attempts + 1
                WHERE id = (
                    SELECT id FROM scraping_jobs 
                    WHERE status = 'pending' AND worker_type = 'playwright'
                    ORDER BY priority DESC, created_at ASC 
                    LIMIT 1 
                    FOR UPDATE SKIP LOCKED
                )
                RETURNING id, media_id, media_type, title, slug, attempts
            """)
            row = cur.fetchone()
            conn.commit()

            if not row:
                log.skip("No more playwright jobs")
                break

            job_id, media_id, media_type, game_name, slug, attempts = row
            game_name = game_name or slug or "Unknown"
            log.start(f"Processing", type=media_type, game=game_name)

            all_links = []

            if media_type in ["game", "jeu"]:
                collected = []
                # Alias explicites: un mod ou un heritage dont la fiche porte
                # le nom du jeu de base. Cle = slug, verifie unique en base
                # (562 slugs distincts sur 562 jeux).
                aliases = GAME_ALIASES.get(str(slug or game_name or ""), [])
                query = search_query(game_name)

                for site_name, base_url in GAME_SOURCES:
                    try:
                        search_url = base_url + query.replace(" ", "+")
                        page = fetch_site_page(site_name, search_url)

                        if getattr(page, 'status', 200) == 200:
                            site_links = extract_game_links(page, search_url, game_name)
                            # Filtre AVANT de limiter: avant on prenait les 5
                            # premiers liens de la page sans verifier, donc on
                            # attachait au jeu demande des liens d'autres jeux.
                            valid = pick(site_links, game_name, aliases, per_source=2)
                            if valid:
                                collected.extend(valid)
                            elif site_links:
                                # La page a repondu mais aucun titre ne correspond.
                                log.warning("no match", type=media_type,
                                            game=game_name, source=site_name,
                                            candidats=len(site_links))
                    except Exception as e:
                        log.warning("source failed", type=media_type, game=game_name,
                                    source=site_name, error=str(e)[:120])
                        continue
                all_links = collected[:6]
            else:
                log.skip(f"Unsupported type: {media_type}")
                cur.execute("UPDATE scraping_jobs SET status = 'skipped', updated_at = NOW() WHERE id = %s", (job_id,))
                conn.commit()
                continue

            if all_links:
                requests.post(
                    f"{internal_api_url}/ingest/liens",
                    json={"mediaId": media_id, "links": all_links},
                    headers={"X-Internal-API-Key": internal_api_key},
                    timeout=15
                )
                cur.execute("UPDATE scraping_jobs SET status = 'completed', updated_at = NOW() WHERE id = %s", (job_id,))
                conn.commit()
                jobs_processed += 1
                log.success(f"Ingested {len(all_links)} links", game=game_name)
            else:
                # Aucun lien valide apres filtrage. distinct de "failed": le job a
                # bien ete traite, le jeu n'est simplement pas sur les sources, ou
                # pas sous ce nom. On le note pour leger sans le relancer en boucle.
                if attempts >= 2:
                    cur.execute(
                        "UPDATE scraping_jobs SET status = 'no_match', last_error = %s, updated_at = NOW() WHERE id = %s",
                        ("Aucun lien verifie pour ce titre apres filtrage", job_id))
                    log.warning(f"no_match (aucun lien verifie): {game_name}")
                    no_match_jobs += 1
                else:
                    cur.execute("UPDATE scraping_jobs SET status = 'pending', updated_at = NOW() WHERE id = %s", (job_id,))
                    log.retry(f"No verified link: {game_name}", attempts, 2)
                conn.commit()

        except Exception as e:
            errors += 1
            log.error(f"Worker error: {e}")
            if job_id:
                try:
                    cur.execute("UPDATE scraping_jobs SET status = 'failed', last_error = %s, updated_at = NOW() WHERE id = %s", (str(e), job_id))
                    conn.commit()
                except: pass
            log.error("Fatal error, shutting down")
            sys.exit(1)

    conn.close()
    log.summary(jobs_processed, errors)


def search_title_direct(game_name):
    """Search for a specific title across all game sources and print results."""
    internal_api_url = os.environ.get("INTERNAL_API_URL", "")
    internal_api_key = os.environ.get("INTERNAL_API_KEY", "")
    GAME_SOURCES = [
        ("steamunlocked.org", "https://steamunlocked.org/?s="),
        ("fitgirl-repacks.site", "https://fitgirl-repacks.site/?s="),
        ("gamedrive.org", "https://gamedrive.org/?s="),
        ("elamigos.site", "https://elamigos.site/?q="),
        ("romspure.cc", "https://romspure.cc/?s="),
        ("cfinder.xyz", "https://cfinder.xyz/api/cracks/search/"),
        ("emulatorgamesx.net", "https://www.emulatorgamesx.net/?s="),
        ("romsfun.com", "https://romsfun.com/?s="),
        ("games4u.org", "https://games4u.org/?s="),
        ("steamrip.com", "https://steamrip.com/?s="),
    ]
    all_links = []
    search_name = clean_search_title(game_name)
    for site_name, base_url in GAME_SOURCES:
        try:
            search_url = base_url + search_name.replace(" ", "+")
            page = fetch_site_page(site_name, search_url)
            if getattr(page, 'status', 200) == 200:
                site_links = extract_game_links(page, search_url, search_name)
                if site_links:
                    all_links.extend(site_links[:5])
        except Exception:
            continue
    print(f"[DIRECT] Found {len(all_links)} links for '{game_name}':")
    for link in all_links:
        print(f"  - {link.get('url', 'N/A')} ({link.get('source_site', 'N/A')})")

if __name__ == "__main__":
    import sys
    if "--title" in sys.argv:
        idx = sys.argv.index("--title")
        if idx + 1 < len(sys.argv):
            search_title_direct(sys.argv[idx + 1])
        else:
            print("Usage: --title <game-title>")
    else:
        threading.Thread(target=run_health_server, daemon=True).start()
        process_jobs()
