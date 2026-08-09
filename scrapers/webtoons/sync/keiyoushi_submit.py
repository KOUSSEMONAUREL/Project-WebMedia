#!/usr/bin/env python3
"""Soumission pure-code des resultats de l'agent keiyoushi.

L'agent (IA) ne fait qu'analyser, ecrire les fichiers et produire un handoff
JSON. Ce script, lui, realise les actions systeme : branches, commits, push,
PRs, commentaire et fermeture d'issue. Aucune IA impliquee ici.

Handoff attendu (chemin: $HANDOFF_FILE):
{
  "issue": <number>,
  "close": true|false,
  "summary_md": "<markdown de synthese (table des verdicts)>",
  "changes": [
    {
      "ext": "<extension>",
      "type": "BUILD|ADAPT|REMOVE",
      "paths": ["<fichiers .ts concernes>"],
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
HANDOFF = os.environ.get("HANDOFF_FILE", "/tmp/keiyoushi_handoff.json")
PR_LIST_FILE = os.environ.get("PR_LIST_FILE", "/tmp/keiyoushi_prs.json")

COMMITTER_NAME = "github-actions[bot]"
COMMITTER_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com"


def safe_ext(ext: str) -> str:
    """Slug du dossier upstream en identifiant de branche/fichier sure.

    L'agent peut ecrire `fr/mangamoins` (avec dossier) au lieu de `mangamoins`.
    On normalise: slash -> tiret, on retire les caracteres a risque.
    """
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

    pr_urls: list[str] = []
    for i, change in enumerate(changes):
        ext = safe_ext(change.get("ext", ""))
        kind = change["type"]
        branch = f"fix/keiyoushi-{ISSUE}-{ext}"
        paths = change.get("paths", [])

        if kind in ("BUILD", "ADAPT"):
            missing = [p for p in paths if not os.path.exists(p)]
            if missing:
                msg = (
                    f"Handoff invalide: fichiers manquants pour `{ext}`: {missing}. "
                    "L'agent n'a pas ecrit les fichiers attendus. Issue laissee ouverte."
                )
                print("ERROR:", msg)
                sys.exit(1)

        run("git", "stash", "push", "-u", "-m", f"keiyoushi-{ISSUE}-pending", check=False)
        run("git", "branch", "-D", branch, check=False)
        run("git", "switch", "-c", branch, "main")
        run("git", "stash", "pop", check=False)

        run("git", "add", "-A", "--", *paths)
        run("git", "commit", "-m", change["commit_msg"])
        run("git", "push", "-u", "--force", "origin", branch)

        existing = run("gh", "pr", "view", branch, "--repo", REPO,
                       "--json", "url", "-q", ".url", check=False)
        if existing:
            url = existing
            print(f"PR existante pour {ext}: {url}")
        else:
            body_file = f"/tmp/keiyoushi_pr_body_{ext}.md"
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

    print(json.dumps({
        "ok": True,
        "pr_urls": pr_urls,
        "pr_list_written": PR_LIST_FILE,
    }, indent=2))


if __name__ == "__main__":
    main()
