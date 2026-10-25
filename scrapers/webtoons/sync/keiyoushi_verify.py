#!/usr/bin/env python3
"""Verification finale independante du pipeline keiyoushi.

Ne fait AUCUNE confiance a l'agent ni a ses artefacts : ce script verifie
les faits reels (fichiers sur disque, etat des PRs et de l'issue sur
GitHub, presence d'un verdict du gate pour chaque PR) apres le cycle
complet (agent -> submit -> gate deterministe -> merge). S'il detecte un
cycle incoherent (agent mort sans handoff, PR sans verdict, PASS non
mergee, PR mergee sans PASS, issue restee ouverte alors que tout est
merge, etc.), il commente l'issue et sort en erreur (exit 1).

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
    close = (
        bool(handoff.get("close", False))
        if isinstance(handoff, dict) else False
    )

    if handoff is None:
        problems.append(
            "L'agent est mort sans produire de handoff (fichier absent). "
            "Le cycle ne s'est PAS termine: l'issue reste ouverte sans "
            "aucun traitement soumis. Job marque en echec pour alerter."
        )
    elif not isinstance(handoff, dict):
        problems.append(
            "Le handoff n'est pas un objet JSON valide: impossible de "
            "verifier le cycle."
        )
    else:
        pr_list = load_json(PR_LIST_FILE) or []
        if not isinstance(pr_list, list):
            problems.append("PR_LIST_FILE n'est pas une liste JSON.")
            pr_list = []

        skipped = skipped_changes()
        if skipped:
            problems.append(
                f"{len(skipped)} extension(s) ecartee(s) car le handoff "
                "listait des fichiers absents du disque: "
                + "; ".join(skipped)
            )

        if not pr_list:
            if close:
                problems.append(
                    "close=true dans le handoff mais aucune PR listee: "
                    "rien n'a ete soumis."
                )
        else:
            review = load_json(REVIEW_FILE)
            if not isinstance(review, dict):
                problems.append(
                    "REVIEW_FILE absent ou illisible: le gate deterministe "
                    "n'a produit aucun verdict."
                )
                review = {"prs": []}
            elif review.get("gate_version") != 1:
                problems.append(
                    "REVIEW_FILE n'a pas ete produit par le gate deterministe "
                    "(gate_version != 1)."
                )

            raw_prs = review.get("prs", [])
            if not isinstance(raw_prs, list):
                problems.append("REVIEW_FILE.prs n'est pas une liste.")
                raw_prs = []
            gate_entries = {
                v.get("number"): v
                for v in raw_prs if isinstance(v, dict)
            }

            all_merged = True
            for pr in pr_list:
                if not isinstance(pr, dict) or "number" not in pr:
                    problems.append("Entree invalide dans PR_LIST_FILE.")
                    all_merged = False
                    continue
                num = pr["number"]
                pr_view = gh(
                    "pr", "view", str(num),
                    "--json", "state,headRefOid",
                    "-q", '.state + " " + .headRefOid',
                )
                pr_state = "?"
                pr_head = ""
                if pr_view.returncode == 0:
                    parts = pr_view.stdout.strip().split(" ", 1)
                    pr_state = parts[0] if parts else "?"
                    pr_head = parts[1] if len(parts) > 1 else ""

                entry = gate_entries.get(num)
                verdict = entry.get("verdict") if isinstance(entry, dict) else None
                gate_head = (
                    str(entry.get("head_sha") or "")
                    if isinstance(entry, dict) else ""
                )

                if verdict is None:
                    problems.append(
                        f"PR #{num} sans verdict de gate "
                        "(le fichier de revue est incomplet)."
                    )
                elif verdict not in ("PASS", "FAIL", "HOLD"):
                    problems.append(
                        f"PR #{num} a un verdict inconnu: {verdict!r}."
                    )

                if pr_state != "MERGED":
                    all_merged = False
                    if verdict == "PASS":
                        problems.append(
                            f"PR #{num} a un verdict PASS mais n'est pas mergee "
                            f"(etat={pr_state})."
                        )
                elif verdict in ("FAIL", "HOLD"):
                    problems.append(
                        f"PR #{num} a ete mergee avec le verdict {verdict} "
                        "(merge automatique interdit)."
                    )

                if verdict == "PASS":
                    if not gate_head:
                        problems.append(
                            f"PR #{num} a un verdict PASS sans head_sha: "
                            "impossible de prouver que la tete testee a ete mergee."
                        )
                    elif not pr_head:
                        problems.append(
                            f"PR #{num} a un verdict PASS mais sa tete est "
                            "illisible sur GitHub."
                        )
                    elif gate_head != pr_head:
                        problems.append(
                            f"PR #{num}: la tete actuelle ({pr_head[:12]}) differe "
                            f"de la tete testee par le gate ({gate_head[:12]})."
                        )

            if close and all_merged and not skipped and state != "CLOSED":
                problems.append(
                    "Toutes les PRs sont mergees mais l'issue #"
                    f"{ISSUE} est restee ouverte (le merge aurait du la fermer)."
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
