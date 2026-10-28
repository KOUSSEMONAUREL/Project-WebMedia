#!/usr/bin/env python3
"""Application des verdicts et merge des PRs keiyoushi.

Pipeline: agent (analyse) -> submit (cree branches + PRs, ecrit la PR list)
-> gate deterministe (verdicts dans $REVIEW_FILE) -> revue IA independante
(verdicts dans $AI_REVIEW_FILE) -> ce script applique la fusion des deux
couches: le gate FAIL reste definitif, la revue IA peut confirmer/refuser un
PASS ou debloquer un HOLD avec preuve. Les PRs PASS sont mergees en squash;
les FAIL/HOLD restent ouvertes.

Si la revue IA est absente, seuls les verdicts du gate sont appliques. Si
elle est presente mais invalide ou partielle, les PASS du gate concernes
sont bloques en HOLD; les FAIL/HOLD du gate restent definitifs. L'IA ne fait
jamais le merge elle-meme.
"""

import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import keiyoushi_review_policy as policy  # noqa: E402

REPO = os.environ.get("GITHUB_REPOSITORY", "KOUSSEMONAUREL/Project-WebMedia")
ISSUE = os.environ["ISSUE_NUMBER"]
HANDOFF = os.environ.get("HANDOFF_FILE", "/tmp/keiyoushi_handoff.json")
PR_LIST_FILE = os.environ.get("PR_LIST_FILE", "/tmp/keiyoushi_prs.json")
REVIEW_FILE = os.environ.get("REVIEW_FILE", "/tmp/keiyoushi_review.json")
AI_REVIEW_FILE = os.environ.get(
    "AI_REVIEW_FILE", "/tmp/keiyoushi_ai_review.json"
)
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
    result = run_raw(
        "gh", "issue", "comment", str(ISSUE), "--repo", REPO,
        "--body-file", path,
    )
    if result.returncode != 0:
        print(
            "COMMENT_WARNING: issue: "
            f"{(result.stderr or result.stdout).strip()}"
        )


def comment_pr(number: int, body: str) -> None:
    path = f"/tmp/keiyoushi_pr_comment_{number}.md"
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    result = run_raw(
        "gh", "pr", "comment", str(number), "--repo", REPO,
        "--body-file", path,
    )
    if result.returncode != 0:
        print(
            f"COMMENT_WARNING: PR #{number}: "
            f"{(result.stderr or result.stdout).strip()}"
        )


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


def merge_with_retry(url: str, expected_head: str) -> tuple[bool, str]:
    """Squash-merge une PR deja verifiee par le gate et la revue IA.

    On ne fait pas `update-branch`: cela changerait la tete de la PR apres
    la verification et invaliderait le head_sha du gate. Sans protection de
    branche, GitHub accepte une PR derriere main si elle reste mergeable.
    Un refus est remonte tel quel; on ne retente que le calcul transitoire
    de `mergeable`.
    """
    last_error = "raison inconnue"
    for attempt in range(1, 4):
        result = run_raw(
            "gh", "pr", "merge", "--squash", "--delete-branch",
            "--match-head-commit", expected_head, url, "--repo", REPO,
        )

        state = pr_state(url)
        if state == "MERGED":
            return True, ""
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
            if state == "CLOSED":
                return False, "PR fermee sans etre mergee"
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
        close = (
            handoff.get("close") is True
            if isinstance(handoff, dict) else False
        )
    except (OSError, ValueError):
        pass

    try:
        pr_list = json.load(open(PR_LIST_FILE, encoding="utf-8"))
        if not isinstance(pr_list, list):
            pr_list = []
    except (OSError, ValueError):
        pr_list = []

    gate = policy.load_json(REVIEW_FILE)
    ai = policy.load_json(AI_REVIEW_FILE)
    ai_present = os.path.exists(AI_REVIEW_FILE)
    numbers = [
        pr["number"] for pr in pr_list
        if (
            isinstance(pr, dict)
            and type(pr.get("number")) is int
            and pr["number"] > 0
        )
    ]
    verdicts, review_source, review_errors = policy.effective_review(
        gate, ai, numbers, ai_present=ai_present
    )
    if (
        not isinstance(gate, dict)
        or type(gate.get("gate_version")) is not int
        or gate.get("gate_version") != 1
    ):
        raw = ""
        try:
            with open(REVIEW_FILE, encoding="utf-8", errors="replace") as f:
                raw = f.read(2000)
        except OSError as e:
            raw = f"<non lisible: {e}>"
        print("REVIEW_ERROR: fichier de gate illisible ou invalide\n"
              f"  path={REVIEW_FILE}\n"
              f"  contenu brut: {raw!r}")
    reviewer_model = (
        str(ai.get("reviewer_model") or "")
        if isinstance(ai, dict) and review_source in ("ai", "mixed")
        else ""
    )
    if review_source == "ai":
        reviewer_label = "gate deterministe + revue IA"
        if reviewer_model:
            reviewer_label += f" ({reviewer_model})"
    elif review_source == "mixed":
        reviewer_label = "gate deterministe + revue IA partielle"
        if reviewer_model:
            reviewer_label += f" ({reviewer_model})"
    elif review_source == "fallback":
        reviewer_label = (
            "gate deterministe (revue IA invalide/partielle: "
            "PASS bloques en HOLD)"
        )
    else:
        reviewer_label = "gate deterministe seul"

    merged: list[str] = []
    failed: list[str] = []
    held: list[str] = []
    unreviewed: list[str] = []

    for pr in pr_list:
        if not isinstance(pr, dict):
            continue
        num = pr.get("number")
        if type(num) is not int or num <= 0:
            unreviewed.append("- [ ] PR sans numero entier valide dans la PR list")
            continue
        url = str(pr.get("url") or "")
        title = str(pr.get("title") or "")
        v = verdicts.get(num)
        if not isinstance(v, dict):
            unreviewed.append(
                f"- [ ] PR #{num} ({title}) ({url}) - pas de verdict final"
            )
            continue

        verdict = v.get("verdict")
        reason = str(v.get("reason") or "")[:2000]
        if verdict == "PASS":
            expected = str(v.get("head_sha") or "")
            current = pr_head(url) if url else ""
            if not expected:
                unreviewed.append(
                    f"- [ ] PR #{num} ({title}) ({url}) - PASS sans head_sha "
                    f"(sortie de revue incomplete)"
                )
                continue
            if not current or current != expected:
                failed.append(
                    f"- [ ] PR #{num} ({title}) **head change depuis la revue** ({url})\n"
                    f"  Verifie: {expected[:12]} | actuel: {current[:12] or 'inconnu'}"
                )
                comment_pr(num, (
                    f"Revue: **{reviewer_label}** PASS sur `{expected[:12]}`, "
                    f"mais la tete de la PR est maintenant "
                    f"`{current[:12] or 'inconnue'}`.\n\n"
                    f"Merge refuse: relancer le gate et la revue sur la tete "
                    f"actuelle."
                ))
                continue
            ok, merge_reason = merge_with_retry(url, expected)
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
                f"Revue: **{reviewer_label}**\n\n"
                f"Verdict: **FAIL**\n\n"
                f"Raison: {reason}\n\n"
                f"PR laissee ouverte pour revue humaine."
            ))
        elif verdict == "HOLD":
            held.append(
                f"- [ ] PR #{num} ({title}) **HOLD** ({url})\n"
                f"  Raison: {reason}"
            )
            comment_pr(num, (
                f"Revue: **{reviewer_label}**\n\n"
                f"Verdict: **HOLD** (revue humaine requise)\n\n"
                f"Raison: {reason}\n\n"
                f"PR laissee ouverte, aucun merge automatique."
            ))
        else:
            unreviewed.append(
                f"- [ ] PR #{num} ({title}) ({url}) - verdict inconnu: {verdict!r}"
            )

    parts: list[str] = []
    if merged:
        parts.append("## PRs mergees (squash)")
        parts.extend(merged)
        parts.append("")
    if failed:
        parts.append("## PRs a revoir (FAIL / merge echoue)")
        parts.extend(failed)
        parts.append("")
    if held:
        parts.append("## PRs en attente de revue humaine (HOLD)")
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
        f"**Revue appliquee**: {reviewer_label}. Le gate deterministe reste "
        "la couche de securite (scope, tsc, live probe native, baseUrl "
        "upstream, registre)."
    )
    if review_errors:
        parts.append(
            "**Revue IA (partielle/invalide)**: "
            + "; ".join(review_errors)[:1200]
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
            "--comment",
            f"Issue traitee: toutes les PRs mergees ({reviewer_label} OK).")

    print(json.dumps({
        "ok": True,
        "merged": len(merged),
        "failed": len(failed),
        "held": len(held),
        "unreviewed": len(unreviewed),
        "skipped": len(skipped),
        "review_source": review_source,
        "reviewer_model": reviewer_model,
        "review_errors": review_errors,
        "issue_closed": bool(close and cycle_complete),
    }, indent=2))


if __name__ == "__main__":
    main()