#!/usr/bin/env python3
"""Verification finale independante du pipeline keiyoushi.

Ne fait AUCUNE confiance a l'agent ni a ses artefacts : ce script verifie
les faits reels (fichiers sur disque, etat des PRs et de l'issue sur
GitHub) apres le cycle complet (agent -> submit -> review -> merge).
S'il detecte un cycle inacheve (agent mort sans handoff, PRs absentes,
issue restee ouverte alors que tout est merge, etc.), il commente
l'issue et sort en erreur (exit 1) pour rendre le job rouge.

Aucune IA impliquee ici.
"""

import json
import os
import subprocess
import sys

REPO = os.environ.get("GITHUB_REPOSITORY", "KOUSSEMONAUREL/Project-WebMedia")
ISSUE = os.environ.get("ISSUE_NUMBER", "")
HANDOFF = os.environ.get("HANDOFF_FILE", "/tmp/keiyoushi_handoff.json")
PR_LIST_FILE = os.environ.get("PR_LIST_FILE", "/tmp/keiyoushi_prs.json")
REVIEW_FILE = os.environ.get("REVIEW_FILE", "/tmp/keiyoushi_review.json")


def gh(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["gh", *args, "--repo", REPO], capture_output=True, text=True
    )


def comment_issue(body: str) -> None:
    path = "/tmp/keiyoushi_verify_alert.md"
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    gh("issue", "comment", ISSUE, "--body-file", path)


def load_json(path: str):
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def main() -> None:
    if not ISSUE:
        print("Aucune issue, rien a verifier.")
        return

    problems: list[str] = []

    view = gh("issue", "view", ISSUE, "--json", "state", "-q", ".state")
    if view.returncode != 0:
        problems.append(f"Impossible de lire l'issue #{ISSUE} sur GitHub: "
                        f"{view.stderr.strip()}")
        state = "?"
    else:
        state = view.stdout.strip()

    handoff = load_json(HANDOFF)
    close = bool(handoff.get("close", False)) if handoff else False

    if state == "CLOSED":
        print(f"Issue #{ISSUE} fermee, cycle complet - OK.")
        print(json.dumps({"ok": True, "issue": ISSUE, "state": state}, indent=2))
        return

    if state == "OPEN" and handoff is None:
        problems.append(
            "L'agent est mort sans produire de handoff (fichier absent). "
            "Le cycle ne s'est PAS termine: l'issue reste ouverte sans "
            "aucun traitement soumis. Job marque en echec pour alerter."
        )
    elif handoff is not None and close:
        pr_list = load_json(PR_LIST_FILE) or []
        if not pr_list:
            problems.append(
                "close=true dans le handoff mais aucune PR listee: "
                "rien n'a ete soumis."
            )

        review = load_json(REVIEW_FILE) or {"prs": []}
        verdicts = {v.get("number"): v.get("verdict") for v in review.get("prs", [])}

        all_merged = True
        for pr in pr_list:
            num = pr.get("number")
            pr_view = gh("pr", "view", str(num), "--json", "state", "-q", ".state")
            pr_state = pr_view.stdout.strip() if pr_view.returncode == 0 else "?"
            if pr_state != "MERGED":
                all_merged = False
                verdict = verdicts.get(num, "?")
                if verdict != "FAIL":
                    problems.append(
                        f"close=true mais PR #{num} non mergee "
                        f"(etat={pr_state}, verdict={verdict})."
                    )

        if all_merged and state != "CLOSED":
            problems.append(
                "Toutes les PRs sont mergees mais l'issue #"
                f"{ISSUE} est restee ouverte (le merge aurait du la fermer)."
            )

        all_pass = all(
            verdicts.get(pr.get("number")) == "PASS" for pr in pr_list
        )
        paths = [p for c in handoff.get("changes", []) for p in c.get("paths", [])]
        if all_pass:
            missing = [p for p in paths if not os.path.exists(p)]
            if missing:
                problems.append(
                    f"Fichiers annonces dans le handoff absents du disque: {missing}"
                )

    if problems:
        body = (
            "## :rotating_light: Alerte verification finale "
            "(independante de l'agent)\n"
            + "\n".join(f"- {p}" for p in problems)
            + "\n\nLe job CI est passe en echec pour attirer l'attention."
        )
        comment_issue(body)
        print("VERIFY_FAIL:")
        for p in problems:
            print(" -", p)
        sys.exit(1)

    print(json.dumps({
        "ok": True,
        "issue": ISSUE,
        "state": state,
        "handoff": handoff is not None,
        "checked": True,
    }, indent=2))


if __name__ == "__main__":
    main()
