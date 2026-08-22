#!/usr/bin/env python3
"""Verification independante des selecteurs du scraper Playwright/Scrapling.

Teste chaque site de GAME_SOURCES avec des titres canaries connus pour
exister sur ce site. Un site est "BROKEN" si le site repond 200 mais
qu'aucun canary ne produit de lien (selecteur probablement obsolet apres
un changement du HTML du site). Les sites injoignables (403/429/erreur
reseau) sont marques UNREACHABLE et ne declenchent pas d'alerte (pas un
souci de selecteur).

Sorties:
  - /tmp/scraper_report.json : rapport JSON complet
  - /tmp/scraper_issue_body.md : corps d'issue markdown (si sites cassés)
  - stdout : rapport compact
  - exit 0 si tout est OK, exit 1 si au moins un site BROKEN

Aucune IA impliquee ici.
"""

import json
import os
import sys
import time
import warnings

warnings.filterwarnings("ignore")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import logging
logging.basicConfig(level=logging.CRITICAL)

from scrapling import Fetcher
from main import extract_game_links, clean_search_title

REPORT_FILE = os.environ.get("SCRAPER_REPORT_FILE", "/tmp/scraper_report.json")
ISSUE_BODY_FILE = os.environ.get("SCRAPER_ISSUE_BODY_FILE", "/tmp/scraper_issue_body.md")

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

CANARIES = {
    "steamunlocked.org": ["Mario", "GTA", "Elden Ring"],
    "fitgirl-repacks.site": ["Mario", "Elden Ring", "Cyberpunk 2077"],
    "gamedrive.org": ["Mario", "Elden Ring", "Cyberpunk 2077"],
    "elamigos.site": ["Mario", "Elden Ring"],
    "romspure.cc": ["Mario", "Zelda", "Pokemon"],
    "cfinder.xyz": ["Mario", "Elden Ring"],
    "emulatorgamesx.net": ["Mario", "Zelda", "Pokemon"],
    "romsfun.com": ["Mario", "Zelda", "Pokemon"],
    "games4u.org": ["Mario", "Elden Ring"],
    "steamrip.com": ["Mario", "Elden Ring", "Cyberpunk 2077"],
}

CHALLENGE_MARKERS = [
    "just a moment",
    "cf-browser-verification",
    "cf-chl-",
    "attention required",
    "checking your browser",
    "ddos-guard",
    "enable javascript and cookies",
    "verify you are human",
    "captcha",
]


def is_challenge_page(page) -> bool:
    """Detecte une page de protection anti-bot (Cloudflare, DDoS-Guard...).

    Un tel blocage n'est pas un souci de selecteur: le site est simplement
    injoignable depuis l'IP du runner (datacenter/cloud). On le classe donc
    UNREACHABLE et on ne declenche pas d'alerte.
    """
    try:
        text = (page.get_all_text() or "")[:4000].lower()
        html = ""
        try:
            html = str(page.body) if hasattr(page, "body") else ""
        except Exception:
            html = ""
        haystack = text + " " + html[:4000].lower()
        return any(marker in haystack for marker in CHALLENGE_MARKERS)
    except Exception:
        return False


def check_site(site_name: str, base_url: str, canaries: list[str]) -> dict:
    """Teste un site avec ses canaries. Retourne le statut par canary."""
    results = {}
    statuses = []
    for title in canaries:
        try:
            search_url = base_url + clean_search_title(title).replace(" ", "+")
            kwargs = {
                "impersonate": "chrome",
                "stealthy_headers": True,
                "timeout": 30,
                "verify": False,
            }
            page = Fetcher.get(search_url, **kwargs)
            http = getattr(page, "status", 200)
            statuses.append(http)
            if http != 200:
                results[title] = {"http": http, "links": -1}
                continue
            if is_challenge_page(page):
                results[title] = {"http": http, "links": -1, "challenge": True}
                continue
            links = extract_game_links(page, search_url, title)
            results[title] = {"http": http, "links": len(links)}
        except Exception as e:
            results[title] = {"http": 0, "links": -1, "error": str(e)[:150]}
            statuses.append(0)
    return results


def main() -> None:
    report = {
        "date": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sites": {},
        "broken": [],
        "unreachable": [],
        "ok": [],
    }

    for site_name, base_url in GAME_SOURCES:
        canaries = CANARIES.get(site_name, ["Mario"])
        results = check_site(site_name, base_url, canaries)

        http_codes = [r["http"] for r in results.values()]
        link_counts = [r["links"] for r in results.values() if r["links"] >= 0]
        challenges = [r for r in results.values() if r.get("challenge")]

        if challenges and len(challenges) == len(results):
            status = "UNREACHABLE"
            report["unreachable"].append(site_name)
        elif http_codes and all(h not in (200,) for h in http_codes):
            status = "UNREACHABLE"
            report["unreachable"].append(site_name)
        elif link_counts and sum(link_counts) > 0:
            status = "OK"
            report["ok"].append(site_name)
        else:
            status = "BROKEN"
            report["broken"].append(site_name)

        report["sites"][site_name] = {
            "status": status,
            "canaries": results,
        }

    with open(REPORT_FILE, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print(f"[SCRAPER VERIFY] {time.strftime('%Y-%m-%d %H:%M:%S')} | "
          f"{len(report['ok'])} OK | {len(report['broken'])} BROKEN | "
          f"{len(report['unreachable'])} UNREACHABLE")
    for site, data in report["sites"].items():
        detail = " ".join(
            f"{t}={r['links']}" for t, r in data["canaries"].items()
        )
        print(f"  [{data['status']:11}] {site}: {detail}")

    if report["broken"]:
        lines = [
            f"## :rotating_light: Sites scraper casse(s) detectes "
            f"({time.strftime('%d/%m/%Y %H:%M:%S')})",
            "",
            "Le job de verification a teste chaque site avec des titres "
            "canaries connus pour exister dessus. Un site repond 200 mais "
            "aucun canary ne produit de lien -> le selecteur CSS est "
            "probablement obsolet (le site a change son HTML).",
            "",
            "### Sites BROKEN",
            "",
        ]
        for site in report["broken"]:
            data = report["sites"][site]
            canary_str = ", ".join(
                f"{t}={r['links']}" for t, r in data["canaries"].items()
            )
            lines.append(f"- **{site}**: {canary_str}")
        lines.append("")
        if report["unreachable"]:
            lines.append("### Sites injoignables (non alerte, pas un souci de selecteur)")
            lines.append("")
            for site in report["unreachable"]:
                lines.append(f"- {site}")
            lines.append("")
        lines.append(
            "L'agent va inspecter le HTML reel de chaque site casse, "
            "identifier le nouveau selecteur, corriger `scrapers/scrapling-worker/src/main.py`, "
            "retester tous les sites et ouvrir une PR."
        )
        body = "\n".join(lines)
        with open(ISSUE_BODY_FILE, "w", encoding="utf-8") as f:
            f.write(body)
        sys.exit(1)

    print("Tous les sites scraper sont operationnels.")
    sys.exit(0)


if __name__ == "__main__":
    main()
