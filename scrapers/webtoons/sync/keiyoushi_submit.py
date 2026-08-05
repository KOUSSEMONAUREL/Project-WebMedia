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
import subprocess
import sys

REPO = os.environ.get("GITHUB_REPOSITORY", "KOUSSEMONAUREL/Project-WebMedia")
ISSUE = os.environ["ISSUE_NUMBER"]
HANDOFF = os.environ.get("HANDOFF_FILE", "/tmp/keiyoushi_handoff.json")

COMMITTER_NAME = "github-actions[bot]"
COMMITTER_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com"


def run(*args: str, check: bool = True) -> str:
    result = subprocess.run(args, capture_output=True, text=True)
    if check and result.returncode != 0:
        print(f"ERROR: {' '.join(args)}\n{result.stdout}\n{result.stderr}")
        sys.exit(1)
    return result.stdout.strip()


def comment_issue(body: str) -> None:
    path = "/tmp/keiyoushi_comment.md"
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    run("gh", "issue", "comment", str(ISSUE), "--repo", REPO, "--body-file", path)


def main() -> None:
    if not os.path.exists(HANDOFF):
        print("Aucun handoff produit par l'agent, rien a soumettre.")
        return

    with open(HANDOFF, encoding="utf-8") as f:
        handoff = json.load(f)

    changes = handoff.get("changes", [])
    summary_md = handoff.get("summary_md", "")
    close = bool(handoff.get("close", False))

    run("git", "config", "user.name", COMMITTER_NAME)
    run("git", "config", "user.email", COMMITTER_EMAIL)

    pr_urls: list[str] = []
    for i, change in enumerate(changes):
        ext = change["ext"]
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
                comment_issue(msg)
                sys.exit(1)

        run("git", "stash", "push", "-u", "-m", f"keiyoushi-{ISSUE}-pending", check=False)
        run("git", "switch", "-c", branch, "main")
        run("git", "stash", "pop", check=False)

        run("git", "add", "-A", "--", *paths)
        run("git", "commit", "-m", change["commit_msg"])
        run("git", "push", "-u", "origin", branch)

        existing = run("gh", "pr", "view", branch, "--repo", REPO,
                       "--json", "url", "-q", ".url", check=False)
        if existing:
            url = existing
            print(f"PR existante pour {ext}: {url}")
        else:
            body_file = f"/tmp/keiyoushi_pr_body_{ext}.md"
            with open(body_file, "w", encoding="utf-8") as f:
                f.write(change.get("pr_body", ""))
            url = run("gh", "pr", "create", "--repo", REPO,
                      "--title", change["pr_title"], "--body-file", body_file)
            print(f"PR creee pour {ext}: {url}")
        pr_urls.append(url)

    comment_parts: list[str] = []
    if pr_urls:
        comment_parts.append("## Pull requests")
        comment_parts.extend(f"- {url}" for url in pr_urls)
        comment_parts.append("")
    if summary_md:
        comment_parts.append(summary_md)
    if comment_parts:
        comment_issue("\n".join(comment_parts).strip())

    if close:
        run("gh", "issue", "close", str(ISSUE), "--repo", REPO,
            "--comment", "Issue traitee: PRs ouverts (verification 2 cycles), merge laisse a la revue humaine.")

    print(json.dumps({
        "ok": True,
        "pr_urls": pr_urls,
        "issue_commented": bool(comment_parts),
        "issue_closed": close,
    }, indent=2))


if __name__ == "__main__":
    main()
