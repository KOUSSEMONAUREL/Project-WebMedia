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

load_dotenv()

app = Flask(__name__)
@app.route('/health')
@app.route('/')
def health():
    return jsonify({"status": "ok", "worker": "scrapling-worker"})

def run_health_server():
    app.run(host='0.0.0.0', port=8080)

def extract_game_links(page, url, game_name=None):
    found = []

    page_title_match = re.search(r'<title>(.*?)</title>', page.text, re.IGNORECASE | re.DOTALL)
    page_title = page_title_match.group(1).strip() if page_title_match else ""
    final_page_url = getattr(page, 'url', url)

    def add_link(u, source, ltype, valid_button=False):
        found.append({
            "url": u,
            "final_url": u if u.startswith('http') or u.startswith('magnet:') else final_page_url,
            "source_site": source,
            "player_host": ltype,
            "link_type": ltype,
            "page_title": page_title,
            "http_status": getattr(page, 'status', 200),
            "valid_download_button": valid_button,
            "scraped_at": int(time.time())
        })

    if "fitgirl-repacks.site" in url:
        game_links = page.css('article h1.entry-title a::attr(href)').getall()
        game_links = [l for l in game_links if l and l.endswith('/') and "updates-digest" not in l and "category" not in l and "#respond" not in l]
        game_links = list(set(game_links))
        for l in game_links:
            add_link(l, "fitgirl-repacks.site", "page_selection", True)
        return found

    if "steamunlocked.org" in url:
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
        game_links = page.css('div.card h2 a::attr(href), div.card__content a::attr(href)').getall()
        game_links = [l for l in game_links if "/jeux/" in (l or '').lower() or "/games/" in (l or '').lower()]
        game_links = list(set(game_links))
        for l in game_links:
            full_url = l if l.startswith('http') else f"https://cfinder.xyz{l}"
            add_link(full_url, "cfinder.xyz", "page_selection", True)
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
            game_links = filtered[:10]
        else:
            game_links = list(set(game_links))[:5]
        for l in game_links:
            full_url = l if l.startswith('http') else f"https://elamigos.site/{l}"
            add_link(full_url, "elamigos.site", "page_selection", True)
        return found

    if "romspure.cc" in url:
        game_links = page.css('article a::attr(href)').getall()
        game_links = [l for l in game_links if ("/roms/" in (l or '').lower() or "/hacks/" in (l or '').lower())]
        game_links = list(set(game_links))
        for l in game_links:
            add_link(l, "romspure.cc", "page_selection", True)
        return found

    if "emulatorgamesx.net" in url:
        game_links = page.css('article a::attr(href)').getall()
        game_links = [l for l in game_links if "/roms/" in (l or '').lower()]
        game_links = list(set(game_links))
        for l in game_links:
            add_link(l, "emulatorgamesx.net", "page_selection", True)
        return found

    if "romsfun.com" in url:
        all_links = page.css('a::attr(href)').getall()
        game_links = [l for l in all_links if "/roms/" in (l or '').lower() and ".html" in (l or '').lower()]
        game_links = list(set(game_links))
        for l in game_links:
            add_link(l, "romsfun.com", "page_selection", True)
        return found

    if "games4u.org" in url:
        game_links = page.css('div.blog-content a::attr(href)').getall()
        game_links = [l for l in game_links if "?" not in l and "#" not in l and l.count('/') >= 3 and "/category/" not in l and "/author/" not in l and "/tag/" not in l and "/wp-" not in l]
        game_links = list(set(game_links))
        for l in game_links:
            add_link(l, "games4u.org", "page_selection", True)
        return found

    if "steamrip.com" in url:
        game_links = page.css('div#masonry-grid h2.thumb-title a::attr(href), div#masonry-grid a::attr(href)').getall()
        game_links = [l for l in game_links if l and not l.startswith('#') and not l.startswith('http') and not l.startswith('javascript')]
        game_links = list(set(game_links))
        for l in game_links:
            full_url = f"https://steamrip.com/{l}" if not l.startswith('http') else l
            add_link(full_url, "steamrip.com", "page_selection", True)
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
        ("cfinder.xyz", "https://cfinder.xyz/jeux.php?q="),
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
    max_jobs = 20
    start_time = time.time()
    max_duration = 5 * 60

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
                fetcher = Fetcher(auto_wait=True)
                collected = []

                for site_name, base_url in GAME_SOURCES:
                    try:
                        search_url = base_url + game_name.replace(" ", "+")
                        headers = {
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                        }
                        kwargs = {"headers": headers}
                        if site_name == "steamunlocked.org":
                            kwargs["verify"] = False
                        page = fetcher.get(search_url, **kwargs)

                        if getattr(page, 'status', 200) == 200:
                            site_links = extract_game_links(page, search_url, game_name)
                            if site_links:
                                collected.extend(site_links[:5])
                    except Exception as e:
                        continue
                all_links = collected
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
                if attempts >= 3:
                    cur.execute("UPDATE scraping_jobs SET status = 'failed', last_error = 'No links found after 3 attempts', updated_at = NOW() WHERE id = %s", (job_id,))
                    log.error(f"Failed after 3 attempts: {game_name}")
                else:
                    cur.execute("UPDATE scraping_jobs SET status = 'pending', updated_at = NOW() WHERE id = %s", (job_id,))
                    log.retry(f"No links: {game_name}", attempts, 3)
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
        ("cfinder.xyz", "https://cfinder.xyz/jeux.php?q="),
        ("emulatorgamesx.net", "https://www.emulatorgamesx.net/?s="),
        ("romsfun.com", "https://romsfun.com/?s="),
        ("games4u.org", "https://games4u.org/?s="),
        ("steamrip.com", "https://steamrip.com/?s="),
    ]
    fetcher = None
    all_links = []
    for site_name, base_url in GAME_SOURCES:
        try:
            search_url = base_url + game_name.replace(" ", "+")
            if not fetcher:
                fetcher = Fetcher(auto_wait=True)
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
            page = fetcher.get(search_url, headers=headers)
            if getattr(page, 'status', 200) == 200:
                site_links = extract_game_links(page, search_url, game_name)
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
