#!/usr/bin/env python3
"""Application des verdicts du gate et merge des PRs keiyoushi.

Pipeline: agent (analyse) -> submit (cree branches + PRs, ecrit la PR list)
-> gate deterministe (verdicts dans $REVIEW_FILE) -> ce script merge les PRs
PASS en squash, laisse FAIL/HOLD ouvertes, commente l'issue et la ferme si
tout est traite.

Aucune IA impliquee dans la revue ni dans le merge.
"""

import json
import os
import subprocess
import sys
import time

REPO = os.environ.get("GITHUB_REPOSITORY", "KOUSSEMONAUREL/Project-WebMedia")
ISSUE = os.environ["ISSUE_NUMBER"]
HANDOFF = os.environ.get("HANDOFF_FILE", "/tmp/keiyoushi_handoff.json")
PR_LIST_FILE = os.environ.get("PR_LIST_FILE", "/tmp/keiyoushi_prs.json")
REVIEW_FILE = os.environ.get("REVIEW_FILE", "/tmp/keiyoushi_review.json")
SKIPPED_FILE = os.environ.get("SKIPPED_FILE", "/tmp/keiyoushi_skipped.json")


def skipped_changes() -> list[str]:
    try:
        with open(SKIPPED_FILE, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return []
    if not isinstance(data, dict):
        return []
    raw = data.get("skipped", [])
    return [str(x) for x in raw] if isinstance(raw, list) else []


def run_raw(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True)


def run(*args: str, check: bool = True) -> str:
    result = run_raw(*args)
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


def pr_mergeable(url: str) -> str:
    return run("gh", "pr", "view", url, "--repo", REPO,
               "--json", "mergeable", "-q", ".mergeable",
               check=False) or "UNKNOWN"


def pr_head(url: str) -> str:
    return run("gh", "pr", "view", url, "--repo", REPO,
               "--json", "headRefOid", "-q", ".headRefOid",
               check=False) or ""


def merge_with_retry(url: str, number: int) -> tuple[bool, str]:
    """Squash-merge une PR deja verifiee par le gate.

    On ne fait pas `update-branch`: cela changerait la tete de la PR apres
    la verification et invaliderait le head_sha du gate. Sans protection de
    branche, GitHub accepte une PR derriere main si elle reste mergeable.
    Un refus est remonte tel quel; on ne retente que le calcul transitoire
    de `mergeable`.
    """
    last_error = "raison inconnue"
    for attempt in range(1, 4):
        result = run_raw("gh", "pr", "merge", "--squash", "--delete-branch",
                         url, "--repo", REPO)

        if result.returncode == 0:
            for _ in range(6):
                state = pr_state(url)
                if state == "MERGED":
                    return True, ""
                if state == "CLOSED":
                    return False, "PR fermee sans etre mergee"
                time.sleep(5)
            last_error = ("merge accepte par gh mais la PR n'est pas "
                          "passee a MERGED apres 30s")
        else:
            last_error = ((result.stderr or result.stdout).strip()
                          or "refus sans message")
            if pr_mergeable(url) == "UNKNOWN":
                for _ in range(6):
                    time.sleep(10)
                    if pr_mergeable(url) != "UNKNOWN":
                        break
            elif attempt < 3:
                time.sleep(20)

    if pr_mergeable(url) == "UNKNOWN":
        last_error += (" | GitHub rapporte mergeable=UNKNOWN: la tete de la PR "
                       "est desynchronisee de sa branche")
    return False, last_error


def summary_from_handoff() -> str:
    try:
        handoff = json.load(open(HANDOFF, encoding="utf-8"))
        if not isinstance(handoff, dict):
            return ""
        return str(handoff.get("summary_md", ""))
    except (OSError, ValueError):
        return ""


def main() -> None:
    close = False
    try:
        handoff = json.load(open(HANDOFF, encoding="utf-8"))
        close = bool(handoff.get("close", False)) if isinstance(handoff, dict) else False
    except (OSError, ValueError):
        pass

    try:
        pr_list = json.load(open(PR_LIST_FILE, encoding="utf-8"))
        if not isinstance(pr_list, list):
            pr_list = []
    except (OSError, ValueError):
        pr_list = []

    try:
        review = json.load(open(REVIEW_FILE, encoding="utf-8"))
        if not isinstance(review, dict):
            raise ValueError("REVIEW_FILE is not an object")
        if review.get("gate_version") != 1:
            raise ValueError("REVIEW_FILE is not from the deterministic gate")
        raw_prs = review.get("prs", [])
        if not isinstance(raw_prs, list):
            raise ValueError("REVIEW_FILE.prs is not a list")
        verdicts = {
            v["number"]: v for v in raw_prs
            if isinstance(v, dict) and "number" in v
        }
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
    held: list[str] = []
    unreviewed: list[str] = []

    for pr in pr_list:
        if not isinstance(pr, dict) or "number" not in pr:
            continue
        num = pr["number"]
        url = pr.get("url", "")
        title = pr.get("title", "")
        v = verdicts.get(num)
        if not isinstance(v, dict):
            unreviewed.append(
                f"- [ ] PR #{num} ({title}) ({url}) - pas de verdict du gate"
            )
            continue

        verdict = v.get("verdict")
        reason = v.get("reason", "")
        if verdict == "PASS":
            expected = str(v.get("head_sha") or "")
            current = pr_head(url) if url else ""
            if not expected:
                unreviewed.append(
                    f"- [ ] PR #{num} ({title}) ({url}) - PASS sans head_sha "
                    f"(sortie de gate incomplete)"
                )
                continue
            if not current or current != expected:
                failed.append(
                    f"- [ ] PR #{num} ({title}) **head change depuis le gate** ({url})\n"
                    f"  Verifie: {expected[:12]} | actuel: {current[:12] or 'inconnu'}"
                )
                comment_pr(num, (
                    f"Gate: **PASS** sur `{expected[:12]}`, mais la tete de la PR "
                    f"est maintenant `{current[:12] or 'inconnue'}`.\n\n"
                    f"Merge refuse: relancer le gate sur la tete actuelle."
                ))
                continue
            ok, merge_reason = merge_with_retry(url, num)
            if ok:
                merged.append(f"- [x] PR #{num} ({title}) **merged** ({url})")
            else:
                failed.append(
                    f"- [ ] PR #{num} ({title}) **merge echoue** ({url})\n"
                    f"  Raison: {merge_reason}"
                )
        elif verdict == "FAIL":
            failed.append(
                f"- [ ] PR #{num} ({title}) **FAIL** ({url})\n"
                f"  Raison: {reason}"
            )
            comment_pr(num, (
                f"Gate: **FAIL**\n\n"
                f"Raison: {reason}\n\n"
                f"PR laissee ouverte pour revue humaine."
            ))
        elif verdict == "HOLD":
            held.append(
                f"- [ ] PR #{num} ({title}) **HOLD** ({url})\n"
                f"  Raison: {reason}"
            )
            comment_pr(num, (
                f"Gate: **HOLD** (revue humaine requise)\n\n"
                f"Raison: {reason}\n\n"
                f"PR laissee ouverte, aucun merge automatique."
            ))
        else:
            unreviewed.append(
                f"- [ ] PR #{num} ({title}) ({url}) - verdict inconnu: {verdict!r}"
            )

    parts: list[str] = []
    if merged:
        parts.append("## PRs mergees (squash, gate deterministe)")
        parts.extend(merged)
        parts.append("")
    if failed:
        parts.append("## PRs a revoir (gate FAIL / merge echoue)")
        parts.extend(failed)
        parts.append("")
    if held:
        parts.append("## PRs en attente de revue humaine (gate HOLD)")
        parts.extend(held)
        parts.append("")
    if unreviewed:
        parts.append("## PRs sans verdict")
        parts.extend(unreviewed)
        parts.append("")

    all_merged = bool(pr_list) and len(merged) == len(pr_list)
    skipped = skipped_changes()
    if skipped:
        parts.append("## Extensions ecartees du cycle (handoff invalide)")
        parts.extend(f"- [ ] {s}" for s in skipped)
        parts.append("")

    parts.append(
        "**Verification effectuee**: gate deterministe (scope, tsc, live probe "
        "native, baseUrl upstream, registre). Aucune IA dans la revue."
    )
    parts.append("")

    body = "\n".join(parts).strip()
    if body:
        comment_issue(body + "\n\n" + summary_from_handoff())

    # L'issue ne se ferme que si le cycle est complet: toutes les PRs
    # soumises sont mergees ET aucune extension n'a ete ecartee.
    cycle_complete = all_merged and not skipped
    if close and cycle_complete:
        run("gh", "issue", "close", str(ISSUE), "--repo", REPO,
            "--comment", "Issue traitee: toutes les PRs mergees (gate deterministe OK).")

    print(json.dumps({
        "ok": True,
        "merged": len(merged),
        "failed": len(failed),
        "held": len(held),
        "unreviewed": len(unreviewed),
        "skipped": len(skipped),
        "issue_closed": bool(close and cycle_complete),
    }, indent=2))


if __name__ == "__main__":
    main()