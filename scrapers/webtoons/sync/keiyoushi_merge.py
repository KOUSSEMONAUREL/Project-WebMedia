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


def summary_from_handoff() -> str:
    try:
        handoff = json.load(open(HANDOFF, encoding="utf-8"))
        return str(handoff.get("summary_md", ""))
    except (OSError, ValueError):
        return ""


def handoff_has_unresolved(handoff: dict) -> bool:
    """Detecte un 'close:true' abusif: IGNORE anti-bot/WARP ou changement non verifie.

    L'agent annote l'IGNORE non verifie avec un marqueur texte dans summary_md
    (il est oblige de l'ecrire depuis le prompt). On refuse la fermeture si ce
    marqueur est present, meme si toutes les PRs passent.
    """
    summary = str(handoff.get("summary_md", ""))
    markers = [
        "keiyoushi-blocked",
        "WARP still blocked",
        "WARP bloqué",
        "anti-bot",
        "close: false",
        "close:false",
        "unresolved",
        "could not verify",
        "not verified",
        "unable to verify",
    ]
    return any(m in summary.lower() for m in markers)


def main() -> None:
    close = False
    blocked_reason = ""
    try:
        handoff = json.load(open(HANDOFF, encoding="utf-8"))
        close = bool(handoff.get("close", False))
        if close and handoff_has_unresolved(handoff):
            close = False
            blocked_reason = (
                "Fermeture annulee: le handoff signale des entrees non resolues "
                "(IGNORE anti-bot/WARP non verifie). Issue laissee ouverte pour retraitement."
            )
            print("WARNING:", blocked_reason)
    except (OSError, ValueError):
        pass

    try:
        pr_list = json.load(open(PR_LIST_FILE, encoding="utf-8"))
    except (OSError, ValueError):
        pr_list = []

    try:
        review = json.load(open(REVIEW_FILE, encoding="utf-8"))
        verdicts = {v["number"]: v for v in review.get("prs", [])}
    except (OSError, ValueError):
        verdicts = {}

    merged: list[str] = []
    failed: list[str] = []
    unreviewed: list[str] = []

    for pr in pr_list:
        num = pr["number"]
        url = pr["url"]
        v = verdicts.get(num)
        if v and v.get("verdict") == "PASS":
            run("gh", "pr", "merge", "--squash", "--delete-branch",
                url, "--repo", REPO, check=False)
            merged_at = run("gh", "pr", "view", url, "--repo", REPO,
                            "--json", "mergedAt", "-q", ".mergedAt", check=False)
            if merged_at:
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

    if blocked_reason:
        parts.append("## Blocage de fermeture")
        parts.append(blocked_reason)
        body = "\n".join(parts).strip()
        if body:
            comment_issue(body + "\n\n" + summary_from_handoff())
        run("gh", "issue", "edit", str(ISSUE), "--repo", REPO,
            "--add-label", "keiyoushi-blocked", check=False)
        print(json.dumps({
            "ok": True,
            "merged": len(merged),
            "failed": len(failed),
            "unreviewed": len(unreviewed),
            "issue_closed": False,
            "blocked_reason": blocked_reason,
        }, indent=2))
        return

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