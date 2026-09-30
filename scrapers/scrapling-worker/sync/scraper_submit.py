#!/usr/bin/env python3
"""Soumission pure-code des resultats de l'agent game-monitor.

L'agent (IA) ne fait qu'analyser, corriger main.py et produire un handoff
JSON. Ce script realise les actions systeme : branches, commits, push, PRs.
Aucune IA impliquee ici.

Handoff attendu (chemin: $HANDOFF_FILE):
{
  "issue": <number>,
  "close": true|false,
  "summary_md": "<markdown de synthese (table des verdicts)>",
  "changes": [
    {
      "ext": "<site-id ou 'all'>",
      "type": "ADAPT",
      "paths": ["scrapers/scrapling-worker/src/main.py"],
      "commit_msg": "<message de commit>",
      "pr_title": "<titre du PR>",
      "pr_body": "<corps du PR (verdict, verification...)>"
    }
  ]
}
"""

import json
import os
import re
import subprocess
import sys

REPO = os.environ.get("GITHUB_REPOSITORY", "KOUSSEMONAUREL/Project-WebMedia")
ISSUE = os.environ["ISSUE_NUMBER"]
HANDOFF = os.environ.get("HANDOFF_FILE", "/tmp/scraper_handoff.json")
PR_LIST_FILE = os.environ.get("PR_LIST_FILE", "/tmp/scraper_prs.json")
SKIPPED_FILE = os.environ.get("SKIPPED_FILE", "/tmp/scraper_skipped.json")
VALID_TYPES = ("BUILD", "ADAPT", "REMOVE")

COMMITTER_NAME = "github-actions[bot]"
COMMITTER_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com"


def safe_ext(ext: str) -> str:
    """Slug du site en identifiant de branche/file sure."""
    slug = re.sub(r"[^A-Za-z0-9_.-]", "-", ext).strip("/.-")
    return slug or "change"


def run(*args: str, check: bool = True) -> str:
    result = subprocess.run(args, capture_output=True, text=True)
    if check and result.returncode != 0:
        print(f"ERROR: {' '.join(args)}\n{result.stdout}\n{result.stderr}")
        sys.exit(1)
    return result.stdout.strip()


def main() -> None:
    if not os.path.exists(HANDOFF):
        print("Aucun handoff produit par l'agent, rien a soumettre.")
        return

    with open(HANDOFF, encoding="utf-8") as f:
        handoff = json.load(f)

    changes = handoff.get("changes", [])

    run("git", "config", "user.name", COMMITTER_NAME)
    run("git", "config", "user.email", COMMITTER_EMAIL)

    # Validation prealable de TOUS les handoffs, avant toute creation de
    # branche. La boucle ci-dessous ecrase l'etat de git a chaque iteration:
    # un chemin absent n'est visible qu'apres coup, au `git add`, et le script
    # meurtait alors en ayant deja perdu les PRs des iterations precedentes,
    # sans jamais ecrire PR_LIST. On ecarte le changement fautif et on
    # continue sur les autres.
    skipped: list[str] = []
    usable: list[dict] = []
    for change in changes:
        ext = safe_ext(change.get("ext", ""))
        kind = change.get("type")
        if kind not in VALID_TYPES:
            reason = f"type inconnu {kind!r} (attendu {', '.join(VALID_TYPES)})"
        else:
            missing = [p for p in change.get("paths", []) if not os.path.exists(p)]
            if not missing:
                usable.append(change)
                continue
            reason = f"fichiers absents du disque: {', '.join(missing)}"
        skipped.append(f"`{ext}` ({reason})")
        print(f"SKIP: {ext}, {reason}")

    pr_urls: list[str] = []
    for change in usable:
        ext = safe_ext(change.get("ext", ""))
        branch = f"fix/scraper-{ISSUE}-{ext}"
        paths = change.get("paths", [])

        run("git", "stash", "push", "-u", "-m", f"scraper-{ISSUE}-pending", check=False)
        run("git", "branch", "-D", branch, check=False)
        run("git", "switch", "-c", branch, "main")
        run("git", "stash", "pop")

        run("git", "add", "-A", "--", *paths)
        if run("git", "diff", "--cached", "--quiet", check=False):
            # Contenu deja present sur la branche: pas de commit vide, et le
            # cycle continue au lieu de mourir sur `git commit` en check=True.
            print(f"SKIP: {ext} rien a committer, le contenu est deja present")
            skipped.append(f"`{ext}` (rien a committer: contenu deja present)")
            run("git", "switch", "main", check=False)
            continue
        run("git", "commit", "-m", change["commit_msg"])
        run("git", "push", "-u", "--force", "origin", branch)

        existing = run("gh", "pr", "view", branch, "--repo", REPO,
                       "--json", "url", "-q", ".url", check=False)
        if existing:
            url = existing
            print(f"PR existante pour {ext}: {url}")
        else:
            body_file = f"/tmp/scraper_pr_body_{ext}.md"
            os.makedirs(os.path.dirname(body_file) or ".", exist_ok=True)
            with open(body_file, "w", encoding="utf-8") as f:
                f.write(change.get("pr_body", ""))
            url = run("gh", "pr", "create", "--repo", REPO,
                      "--title", change["pr_title"], "--body-file", body_file)
            print(f"PR creee pour {ext}: {url}")
        pr_urls.append(url)

    pr_list = []
    for url in pr_urls:
        number = run("gh", "pr", "view", url, "--repo", REPO,
                     "--json", "number,title", "-q", r'"\(.number)||\(.title)"')
        num, _, title = number.partition("||")
        pr_list.append({"number": int(num), "title": title, "url": url})
    with open(PR_LIST_FILE, "w", encoding="utf-8") as f:
        json.dump(pr_list, f, indent=2)

    # Marqueur de cycle incomplet: merge et verify le lisent pour ne pas
    # fermer l'issue alors que des sites n'ont pas ete soumis.
    with open(SKIPPED_FILE, "w", encoding="utf-8") as f:
        json.dump({"skipped": skipped}, f, indent=2)

    print(json.dumps({
        "ok": not skipped,
        "pr_urls": pr_urls,
        "pr_list_written": PR_LIST_FILE,
        "skipped": skipped,
    }, indent=2))


if __name__ == "__main__":
    main()
