#!/usr/bin/env python3
"""Application des verdicts de revue et merge des PRs keiyoushi.

Pipeline: agent (analyse) -> submit (cree branches + PRs, ecrit la PR list)
-> reviewer (modele, verdicts dans $REVIEW_FILE) -> ce script merge les PRs
PASS en squash, commente l'issue et la ferme si tout est traite.

Aucune IA impliquee ici.
"""

import json
import os
import subprocess
import sys

REPO = os.environ.get("GITHUB_REPOSITORY", "KOUSSEMONAUREL/Project-WebMedia")
ISSUE = os.environ["ISSUE_NUMBER"]
HANDOFF = os.environ.get("HANDOFF_FILE", "/tmp/keiyoushi_handoff.json")
PR_LIST_FILE = os.environ.get("PR_LIST_FILE", "/tmp/keiyoushi_prs.json")
REVIEW_FILE = os.environ.get("REVIEW_FILE", "/tmp/keiyoushi_review.json")


def run(*args: str, check: bool = True) -> str:
    result = subprocess.run(args, capture_output=True, text=True)
    if check and result.returncode != 0:
        print(f"ERROR: {' '.join(args)}\n{result.stdout}\n{result.stderr}")
        sys.exit(1)
    return result.stdout.strip()


def comment_issue(body: str) -> None:
    path = "/tmp/keiyoushi_final_comment.md"
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    run("gh", "issue", "comment", str(ISSUE), "--repo", REPO, "--body-file", path)


def comment_pr(number: int, body: str) -> None:
    path = f"/tmp/keiyoushi_pr_comment_{number}.md"
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    run("gh", "pr", "comment", str(number), "--repo", REPO, "--body-file", path)


def pr_state(url: str) -> str:
    return run("gh", "pr", "view", url, "--repo", REPO,
               "--json", "state", "-q", ".state", check=False) or "UNKNOWN"


def merge_with_retry(url: str, number: int) -> bool:
    """Squash-merge une PR en surmontant les checks UNSTABLE.

    - update-branch d'abord (la PR peut etre derriere main suite a une
      precedente fusion-merge).
    - merge --squash direct (pas --auto: requiert une branch protection
      sur main que le repo n'a pas).
    - On pollue l'etat jusqu'a 12 x 10s; si la PR est encore OPEN (checks
      UNSTABLE qui n'aboutissent jamais), on arrete sans pseudo-echouer.
    - 3 tentatives au total (update + merge + poll), 20s entre les deux.
    """
    for attempt in range(1, 4):
        run("gh", "pr", "update-branch", url, "--repo", REPO, check=False)
        run("gh", "pr", "merge", "--squash", "--delete-branch",
            url, "--repo", REPO, check=False)
        for _ in range(12):
            state = pr_state(url)
            if state == "MERGED":
                return True
            if state == "CLOSED":
                return False
            import time
            time.sleep(10)
        if attempt < 3:
            import time
            time.sleep(20)
    return False


def summary_from_handoff() -> str:
    try:
        handoff = json.load(open(HANDOFF, encoding="utf-8"))
        return str(handoff.get("summary_md", ""))
    except (OSError, ValueError):
        return ""


def main() -> None:
    close = False
    try:
        handoff = json.load(open(HANDOFF, encoding="utf-8"))
        close = bool(handoff.get("close", False))
    except (OSError, ValueError):
        pass

    try:
        pr_list = json.load(open(PR_LIST_FILE, encoding="utf-8"))
    except (OSError, ValueError):
        pr_list = []

    try:
        review = json.load(open(REVIEW_FILE, encoding="utf-8"))
        verdicts = {v["number"]: v for v in review.get("prs", [])}
    except (OSError, ValueError) as e:
        raw = ""
        try:
            with open(REVIEW_FILE, encoding="utf-8", errors="replace") as f:
                raw = f.read(2000)
        except OSError as e2:
            raw = f"<non lisible: {e2}>"
        print(f"REVIEW_ERROR: fichier de revue illisible ({e})\n"
              f"  path={REVIEW_FILE}\n"
              f"  contenu brut: {raw!r}")
        verdicts = {}

    merged: list[str] = []
    failed: list[str] = []
    unreviewed: list[str] = []

    for pr in pr_list:
        num = pr["number"]
        url = pr["url"]
        v = verdicts.get(num)
        if v and v.get("verdict") == "PASS":
            if merge_with_retry(url, num):
                merged.append(f"- [x] PR #{num} ({pr['title']}) **merged** ({url})")
            else:
                failed.append(
                    f"- [ ] PR #{num} ({pr['title']}) **merge echoue** ({url})"
                )
        elif v and v.get("verdict") == "FAIL":
            failed.append(
                f"- [ ] PR #{num} ({pr['title']}) **FAIL** ({url})\n"
                f"  Raison: {v.get('reason', '')}"
            )
            comment_pr(num, (
                f"Revue: **FAIL**\n\n"
                f"Raison: {v.get('reason', '')}\n\n"
                f"PR laissee ouverte pour revue humaine."
            ))
        else:
            unreviewed.append(
                f"- [ ] PR #{num} ({pr['title']}) ({url}) - pas de verdict de revue"
            )

    parts: list[str] = []
    if merged:
        parts.append("## PRs mergees (squash, verification 2 cycles + revue modele)")
        parts.extend(merged)
        parts.append("")
    if failed:
        parts.append("## PRs a revoir (echoues a la revue modele)")
        parts.extend(failed)
        parts.append("")
    if unreviewed:
        parts.append("## PRs sans verdict")
        parts.extend(unreviewed)
        parts.append("")

    all_merged = len(merged) == len(pr_list)
    parts.append(
        "**Revue effectuee**: live probes (WARP), tsc, batch_test cible, "
        "lecture du diff par un modele (reviewer)."
    )
    parts.append("")

    body = "\n".join(parts).strip()
    if body:
        comment_issue(body + "\n\n" + summary_from_handoff())

    if close and all_merged:
        run("gh", "issue", "close", str(ISSUE), "--repo", REPO,
            "--comment", "Issue traitee: toutes les PRs mergees (verification + revue modele OK).")

    print(json.dumps({
        "ok": True,
        "merged": len(merged),
        "failed": len(failed),
        "unreviewed": len(unreviewed),
        "issue_closed": bool(close and all_merged),
    }, indent=2))


if __name__ == "__main__":
    main()