#!/usr/bin/env python3
"""Application des verdicts de revue et merge des PRs game-monitor.

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
HANDOFF = os.environ.get("HANDOFF_FILE", "/tmp/scraper_handoff.json")
PR_LIST_FILE = os.environ.get("PR_LIST_FILE", "/tmp/scraper_prs.json")
REVIEW_FILE = os.environ.get("REVIEW_FILE", "/tmp/scraper_review.json")
SKIPPED_FILE = os.environ.get("SKIPPED_FILE", "/tmp/scraper_skipped.json")


def run_raw(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True)


def run(*args: str, check: bool = True) -> str:
    result = run_raw(*args)
    if check and result.returncode != 0:
        print(f"ERROR: {' '.join(args)}\n{result.stdout}\n{result.stderr}")
        sys.exit(1)
    return result.stdout.strip()


def pr_state(url: str) -> str:
    return run("gh", "pr", "view", url, "--repo", REPO,
               "--json", "state", "-q", ".state", check=False) or "UNKNOWN"


def pr_mergeable(url: str) -> str:
    return run("gh", "pr", "view", url, "--repo", REPO,
               "--json", "mergeable", "-q", ".mergeable",
               check=False) or "UNKNOWN"


def merge_one(url: str) -> tuple[bool, str]:
    """Squash-merge une PR et renvoie (ok, diagnostic).

    Le refus de GitHub etait recupere puis jete: la PR etait simplement
    comptee en "merge echoue", sans la raison, ce qui rendait tout diagnostic
    impossible depuis le log. On remonte desormais le message tel quel, et on
    diagnostique le cas recurrent mergeable=UNKNOWN, ou la tete de branche a
    bouge hors de la PR et GitHub ne resout plus la fusion.
    """
    result = run_raw("gh", "pr", "merge", "--squash", "--delete-branch",
                     url, "--repo", REPO)
    if result.returncode == 0:
        # Le squash est synchrone: une seule verification suffit, pas de poll.
        state = pr_state(url)
        if state == "MERGED":
            return True, ""
        return False, f"merge accepte par gh mais etat={state}"

    reason = (result.stderr or result.stdout).strip() or "refus sans message"
    if pr_mergeable(url) == "UNKNOWN":
        reason += (" | GitHub rapporte mergeable=UNKNOWN: la tete de la PR est "
                   "desynchronisee de sa branche")
    return False, reason


def skipped_changes() -> list[str]:
    try:
        with open(SKIPPED_FILE, encoding="utf-8") as f:
            return list(json.load(f).get("skipped", []))
    except (OSError, ValueError):
        return []


def comment_issue(body: str) -> None:
    path = "/tmp/scraper_final_comment.md"
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    run("gh", "issue", "comment", str(ISSUE), "--repo", REPO, "--body-file", path)


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
            ok, reason = merge_one(url)
            if ok:
                merged.append(f"- [x] PR #{num} ({pr['title']}) **merged** ({url})")
            else:
                failed.append(
                    f"- [ ] PR #{num} ({pr['title']}) **merge echoue** ({url})\n"
                    f"  Raison: {reason}"
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
        parts.append("## PRs mergees (squash, verification live + revue modele)")
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
    skipped = skipped_changes()
    if skipped:
        parts.append("## Sites ecartes du cycle (handoff invalide)")
        parts.extend(f"- [ ] {s}" for s in skipped)
        parts.append("")

    parts.append(
        "**Revue effectuee**: scraper_verify.py (10 sites), test live du/des "
        "site(s) corrige(s), lecture du diff par un modele (reviewer)."
    )
    parts.append("")

    body = "\n".join(parts).strip()
    if body:
        comment_issue(body + "\n\n" + summary_from_handoff())

    # L'issue ne se ferme que si le cycle est complet: toutes les PRs
    # soumises sont mergees ET aucun site n'a ete ecarte.
    cycle_complete = all_merged and not skipped
    if close and cycle_complete:
        run("gh", "issue", "close", str(ISSUE), "--repo", REPO,
            "--comment", "Issue traitee: toutes les PRs mergees (verification + revue modele OK).")

    print(json.dumps({
        "ok": True,
        "merged": len(merged),
        "failed": len(failed),
        "unreviewed": len(unreviewed),
        "skipped": len(skipped),
        "issue_closed": bool(close and cycle_complete),
    }, indent=2))


if __name__ == "__main__":
    main()
