#!/usr/bin/env python3
"""Verification finale independante du pipeline keiyoushi.

Ne fait AUCUNE confiance a l'agent ni a ses artefacts : ce script verifie
les faits reels (fichiers sur disque, etat des PRs et de l'issue sur
GitHub, presence d'un verdict final pour chaque PR) apres le cycle complet
(agent -> submit -> gate deterministe -> revue IA -> merge). S'il detecte
un cycle incoherent (agent mort sans handoff, PR sans verdict, PASS non
mergee, PR mergee sans PASS, issue restee ouverte alors que tout est
merge, etc.), il commente l'issue et sort en erreur (exit 1).

Le script n'appelle aucune IA: il verifie les verdicts deja produits par le
gate et par la revue IA. Si la revue est absente, il retombe sur le gate; si
elle est presente mais invalide ou partielle, il applique la meme regle que
le merge (PASS du gate bloques en HOLD).
"""

import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import keiyoushi_review_policy as policy  # noqa: E402

REPO = os.environ.get("GITHUB_REPOSITORY", "KOUSSEMONAUREL/Project-WebMedia")
ISSUE = os.environ.get("ISSUE_NUMBER", "")
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
        handoff.get("close") is True
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
    elif type(handoff.get("close")) is not bool:
        problems.append(
            "Le handoff n'a pas de champ close booleen: impossible de "
            "savoir si l'issue doit etre fermee."
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

        changes = handoff.get("changes")
        if not isinstance(changes, list):
            problems.append(
                "Le handoff n'a pas de liste changes: impossible de verifier "
                "que toutes les modifications ont ete soumises."
            )
        elif not all(isinstance(change, dict) for change in changes):
            problems.append(
                "Le handoff contient des changements qui ne sont pas des "
                "objets: la soumission ne peut pas etre verifiee."
            )
        elif changes and not pr_list and not skipped:
            problems.append(
                f"Le handoff contient {len(changes)} changement(s) mais "
                "aucune PR ni aucun skip: la soumission s'est probablement "
                "interrompue avant d'ecrire la liste des PRs."
            )
        elif not changes and pr_list:
            problems.append(
                "Des PRs sont listees mais le handoff ne contient aucun "
                "changement: les artefacts sont incoherents."
            )

        if not pr_list:
            if close:
                problems.append(
                    "close=true dans le handoff mais aucune PR listee: "
                    "rien n'a ete soumis."
                )
        else:
            gate = load_json(REVIEW_FILE)
            if not isinstance(gate, dict):
                problems.append(
                    "REVIEW_FILE absent ou illisible: le gate deterministe "
                    "n'a produit aucun verdict."
                )
                gate = {"prs": []}
            elif (
                type(gate.get("gate_version")) is not int
                or gate.get("gate_version") != 1
            ):
                problems.append(
                    "REVIEW_FILE n'a pas ete produit par le gate deterministe "
                    "(gate_version != 1)."
                )

            ai = load_json(AI_REVIEW_FILE)
            numbers = [
                pr["number"] for pr in pr_list
                if (
                    isinstance(pr, dict)
                    and type(pr.get("number")) is int
                    and pr["number"] > 0
                )
            ]
            review_entries, review_source, review_warnings = (
                policy.effective_review(
                    gate, ai, numbers,
                    ai_present=os.path.exists(AI_REVIEW_FILE),
                )
            )
            if review_warnings:
                print("AI_REVIEW_WARNING: " + "; ".join(review_warnings))
            if review_source in ("ai", "mixed") and isinstance(ai, dict):
                label = "partielle" if review_source == "mixed" else "active"
                print(f"AI_REVIEW_{label.upper()}: "
                      + str(ai.get("reviewer_model") or "inconnu"))
            elif review_source == "fallback":
                print("AI_REVIEW_FALLBACK: PASS du gate bloques en HOLD")

            all_merged = True
            for pr in pr_list:
                if not isinstance(pr, dict):
                    problems.append("Entree invalide dans PR_LIST_FILE.")
                    all_merged = False
                    continue
                num = pr.get("number")
                if type(num) is not int or num <= 0:
                    problems.append("Numero de PR invalide dans PR_LIST_FILE.")
                    all_merged = False
                    continue
                pr_view = gh(
                    "pr", "view", str(num),
                    "--json", "state,headRefOid",
                    "-q", '.state + " " + .headRefOid',
                )
                pr_state = "?"
                pr_head = ""
                pr_view_ok = pr_view.returncode == 0
                if pr_view_ok:
                    parts = pr_view.stdout.strip().split(" ", 1)
                    pr_state = parts[0] if parts else "?"
                    pr_head = parts[1] if len(parts) > 1 else ""
                else:
                    problems.append(
                        f"Impossible de lire la PR #{num} sur GitHub: "
                        f"{pr_view.stderr.strip()}"
                    )
                    all_merged = False

                entry = review_entries.get(num)
                verdict = entry.get("verdict") if isinstance(entry, dict) else None
                reviewed_head = (
                    str(entry.get("head_sha") or "")
                    if isinstance(entry, dict) else ""
                )

                if verdict is None:
                    problems.append(
                        f"PR #{num} sans verdict final "
                        "(le fichier de revue est incomplet)."
                    )
                elif verdict not in ("PASS", "FAIL", "HOLD"):
                    problems.append(
                        f"PR #{num} a un verdict inconnu: {verdict!r}."
                    )

                if pr_view_ok:
                    if pr_state == "MERGED":
                        if verdict in ("FAIL", "HOLD"):
                            problems.append(
                                f"PR #{num} a ete mergee avec le verdict "
                                f"{verdict} (merge automatique interdit)."
                            )
                    else:
                        all_merged = False
                        if pr_state == "CLOSED" and verdict in ("FAIL", "HOLD"):
                            problems.append(
                                f"PR #{num} a ete fermee avec le verdict "
                                f"{verdict} (elle doit rester ouverte pour "
                                "revue humaine)."
                            )
                        elif verdict == "PASS":
                            problems.append(
                                f"PR #{num} a un verdict PASS mais n'est pas "
                                f"mergee (etat={pr_state})."
                            )

                if verdict == "PASS" and pr_view_ok:
                    if not reviewed_head:
                        problems.append(
                            f"PR #{num} a un verdict PASS sans head_sha: "
                            "impossible de prouver que la tete testee a ete mergee."
                        )
                    elif not pr_head:
                        problems.append(
                            f"PR #{num} a un verdict PASS mais sa tete est "
                            "illisible sur GitHub."
                        )
                    elif reviewed_head != pr_head:
                        problems.append(
                            f"PR #{num}: la tete actuelle ({pr_head[:12]}) differe "
                            f"de la tete testee ({reviewed_head[:12]})."
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
