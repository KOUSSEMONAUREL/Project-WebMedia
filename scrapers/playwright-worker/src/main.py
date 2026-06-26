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

load_dotenv()

app = Flask(__name__)
@app.route('/health')
@app.route('/')
def health():
    return jsonify({"status": "ok", "worker": "scrapling-worker"})

def run_health_server():
    app.run(host='0.0.0.0', port=8080)

def extract_game_links(page, url, game_name=None):
    """
    Extract game links by site-specific logic and return list of dicts with metadata.
    """
    found = []
    all_links = page.css('a::attr(href)').getall()

    # basic page metadata
    page_title_match = re.search(r'<title>(.*?)</title>', page.text, re.IGNORECASE | re.DOTALL)
    page_title = page_title_match.group(1).strip() if page_title_match else ""
    final_page_url = getattr(page, 'url', url)

    # helper to append a dict
    def add_link(u, source, ltype, valid_button=False):
        found.append({
            "url": u,
            "final_url": u if u.startswith('http') or u.startswith('magnet:') else final_page_url,
            "source_site": source,
            "player_host": ltype, # Requis par le backend
            "link_type": ltype,
            "page_title": page_title,
            "http_status": getattr(page, 'status', 200),
            "valid_download_button": valid_button,
            "scraped_at": int(time.time())
        })

    # 1. FitGirl Repacks
    if "fitgirl-repacks.site" in url:
        all_links = page.css('a::attr(href)').getall()
        # Filter for game pages (ending in / and not containing page or #)
        game_links = [l for l in all_links if "fitgirl-repacks.site" in l and l.endswith('/') and "/page/" not in l and "#" not in l]
        # Unique list
        game_links = list(set(game_links))
        
        for l in game_links:
            add_link(l, "fitgirl-repacks.site", "page_selection", True)
        return found

    # 2. SteamUnlocked
    if "steamunlocked.org" in url:
        all_links = page.css('a::attr(href)').getall()
        # Filter for game pages (usually end with -free-download/)
        game_links = [l for l in all_links if "free-download" in (l or '').lower()]
        # Unique list
        game_links = list(set(game_links))
        
        for l in game_links:
            add_link(l, "steamunlocked.org", "page_selection", True)
        return found

    # 3. GameDrive
    if "gamedrive.org" in url:
        all_links = page.css('a::attr(href)').getall()
        # Filter for game pages (usually containing the game name in the URL and not being a search/page link)
        game_links = [l for l in all_links if "gamedrive.org" in l and "?" not in l and "page" not in l]
        # Unique list
        game_links = list(set(game_links))
        
        for l in game_links:
            add_link(l, "gamedrive.org", "page_selection", True)
        return found

    # 4. cFinder
    if "cfinder.xyz" in url or "directory.cfinder.xyz" in url:
        all_links = page.css('a::attr(href)').getall()
        # Filter for game pages (usually start with /jeux/ or /games/)
        game_links = [l for l in all_links if "/jeux/" in (l or '').lower() or "/games/" in (l or '').lower()]
        # Unique list
        game_links = list(set(game_links))
        
        for l in game_links:
            # Construct full URL if relative
            full_url = l if l.startswith('http') else f"https://cfinder.xyz{l}"
            add_link(full_url, "cfinder.xyz", "page_selection", True)
        return found

    # 5. ElAmigos
    if "elamigos.site" in url:
        all_links = page.css('a::attr(href)').getall()
        # Filter for game pages (usually start with data/ and contain the game name)
        game_links = [l for l in all_links if "data/" in (l or '').lower()]
        # Unique list
        game_links = list(set(game_links))
        
        for l in game_links:
            # Construct full URL
            full_url = f"https://elamigos.site/{l}"
            add_link(full_url, "elamigos.site", "page_selection", True)
        return found

    # 6. RomsPure
    if "romspure.cc" in url:
        all_links = page.css('a::attr(href)').getall()
        # Filter for game pages (containing /roms/ or /hacks/)
        game_links = [l for l in all_links if ("/roms/" in (l or '').lower() or "/hacks/" in (l or '').lower())]
        # Unique list
        game_links = list(set(game_links))
        
        for l in game_links:
            add_link(l, "romspure.cc", "page_selection", True)
        return found

    # 7. EmulatorGamesX
    if "emulatorgamesx.net" in url:
        all_links = page.css('a::attr(href)').getall()
        # Filter for game pages (containing /roms/)
        game_links = [l for l in all_links if "/roms/" in (l or '').lower()]
        # Unique list
        game_links = list(set(game_links))
        
        for l in game_links:
            add_link(l, "emulatorgamesx.net", "page_selection", True)
        return found

    # 8. RomsFun
    if "romsfun.com" in url:
        all_links = page.css('a::attr(href)').getall()
        # Filter for game pages (containing /roms/ and .html)
        game_links = [l for l in all_links if "/roms/" in (l or '').lower() and ".html" in (l or '').lower()]
        # Unique list
        game_links = list(set(game_links))
        
        for l in game_links:
            add_link(l, "romsfun.com", "page_selection", True)
        return found

    # 9. Games4U
    if "games4u.org" in url:
        all_links = page.css('a::attr(href)').getall()
        # Filter for game pages (urls directly under root with game name)
        # Pattern seems to be just https://games4u.org/game-name-year/
        # Let's filter out search/blog links if any
        game_links = [l for l in all_links if "games4u.org" in l and "?" not in l and "page" not in l and len(l.split('/')) == 4]
        # Unique list
        game_links = list(set(game_links))
        
        for l in game_links:
            add_link(l, "games4u.org", "page_selection", True)
        return found

    # 10. SteamRip
    if "steamrip.com" in url:
        all_links = page.css('a::attr(href)').getall()
        # Filter for game pages (usually /game-name/)
        game_links = [l for l in all_links if "steamrip.com" in l and l.count('/') >= 3 and "?" not in l and "#" not in l and "/page/" not in l]
        game_links = list(set(game_links))
        for l in game_links:
            add_link(l, "steamrip.com", "page_selection", True)
        return found

    return found

def process_jobs():
    start_time = time.time()
    max_duration = 5 * 60  # 5 minutes
    
    supabase_url = os.environ.get("SUPABASE_DATABASE_URL", "")
    internal_api_url = os.environ.get("INTERNAL_API_URL", "")
    internal_api_key = os.environ.get("INTERNAL_API_KEY", "")

    if not supabase_url:
        print("❌ SUPABASE_DATABASE_URL is not set. Exiting.")
        return

    try:
        import psycopg2
        conn = psycopg2.connect(supabase_url)
        conn.autocommit = False
        print("✅ Connected to Supabase queue.")
    except Exception as e:
        print(f"❌ Cannot connect to Supabase: {e}")
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

    # ... (in extract_game_links, update to support new sites) ...
    # 8. EmulatorGamesX (WordPress, needs article navigation)
    # 9. RomsFun (WordPress, needs article navigation)
    # 10. Games4U (WordPress, needs article navigation)

    # Pré-check : si aucun job en attente, on sort tout de suite
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM scraping_jobs WHERE status = 'pending' AND worker_type = 'playwright'")
    row = cur.fetchone()
    total = row[0] if row else 0
    if total == 0:
        print("✅ Aucun job playwright en attente. Fin.")
        conn.close()
        return
    print(f"📦 {total} job(s) playwright en attente.")

    print("🐍 Playwright Worker active (Supabase + Sweep Mode)")

    jobs_processed = 0
    max_jobs = 10

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
                print("✅ No more playwright jobs in queue. Exiting.")
                break

            job_id, media_id, media_type, game_name, slug, attempts = row
            game_name = game_name or slug or "Unknown"
            print(f"\n🎮 [{media_type.upper()}] Processing: {game_name}")

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
                        page = fetcher.get(search_url, headers=headers)

                        if getattr(page, 'status', 200) == 200:
                            site_links = extract_game_links(page, search_url, game_name)
                            if site_links:
                                collected.extend(site_links[:5])
                    except Exception as e:
                        continue
                all_links = collected
            
            else:
                print(f"⏭️ Skipping unsupported media type: {media_type}")
                cur.execute("UPDATE scraping_jobs SET status = 'skipped', updated_at = NOW() WHERE id = %s", (job_id,))
                conn.commit()
                continue

            if all_links:
                print(f"  📤 Ingesting {len(all_links)} link(s)...")
                requests.post(
                    f"{internal_api_url}/ingest/liens",
                    json={"mediaId": media_id, "links": all_links},
                    headers={"X-Internal-API-Key": internal_api_key},
                    timeout=15
                )
                
                cur.execute("UPDATE scraping_jobs SET status = 'completed', updated_at = NOW() WHERE id = %s", (job_id,))
                conn.commit()
                jobs_processed += 1
            else:
                if attempts >= 3:
                    cur.execute("UPDATE scraping_jobs SET status = 'failed', last_error = 'No links found after 3 attempts', updated_at = NOW() WHERE id = %s", (job_id,))
                    print(f"  ❌ Failed: {game_name} (Max attempts)")
                else:
                    cur.execute("UPDATE scraping_jobs SET status = 'pending', updated_at = NOW() WHERE id = %s", (job_id,))
                    print(f"  ⏳ Retry: {game_name} (Attempt {attempts}/3)")
                conn.commit()

        except Exception as e:
            print(f"💥 Worker error: {e}")
            if job_id:
                try:
                    # Mark as failed to avoid infinite loop
                    cur.execute("UPDATE scraping_jobs SET status = 'failed', last_error = %s, updated_at = NOW() WHERE id = %s", (str(e), job_id))
                    conn.commit()
                except: pass
            
            # Exit on fatal structural error
            print("🛑 Fatal error detected. Shutting down worker.")
            sys.exit(1)

    conn.close()
    print(f"🏁 Run finished. Processed {jobs_processed} jobs.")


if __name__ == "__main__":
    threading.Thread(target=run_health_server, daemon=True).start()
    process_jobs()
