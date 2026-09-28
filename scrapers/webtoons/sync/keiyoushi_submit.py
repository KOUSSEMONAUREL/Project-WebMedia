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
SKIPPED_FILE = os.environ.get("SKIPPED_FILE", "/tmp/keiyoushi_skipped.json")

COMMITTER_NAME = "github-actions[bot]"
COMMITTER_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com"

ENGINE_DIR = "scrapers/webtoons/engine/"
VALID_TYPES = ("BUILD", "ADAPT", "REMOVE")


def safe_ext(ext: str) -> str:
    """Slug du dossier upstream en identifiant de branche/fichier sure.

    L'agent peut ecrire `fr/mangamoins` (avec dossier) au lieu de `mangamoins`.
    On normalise: slash -> tiret, on retire les caracteres a risque.
    """
    slug = re.sub(r"[^A-Za-z0-9_.-]", "-", ext).strip("/.-")
    if "/" in ext:
        slug = ext.split("/")[-1]
    return slug or "change"


def engine_paths(paths: list[str]) -> set[str]:
    return {p for p in paths
            if p.startswith(ENGINE_DIR) and p.endswith(".ts")}


def group_changes(changes: list[dict]) -> list[list[dict]]:
    """Regroupe les changements qui partagent un moteur.

    L'agent ecrit naturellement UN moteur et N scrapeurs fins qui l'etendent.
    Or chaque PR doit etre autonome: sa branche repart de `main`, donc le
    moteur doit etre dans la PR. Si le handoff le liste sur chaque extension,
    seule la premiere PR peut l'embarquer et les suivantes echouent sur
    `git add: pathspec did not match any files` (observe sur les runs #153 et
    #154 avec `engine/eromuse.ts` et `engine/monochrome.ts`).

    On regroupe donc par moteur partage, en transitivity: deux changements
    qui ont un moteur en commun partent dans la meme PR. Le resultat est
    independant du respect du contrat par l'agent.
    """
    parent = list(range(len(changes)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    owner: dict[str, int] = {}
    for i, change in enumerate(changes):
        for engine in engine_paths(change.get("paths", [])):
            if engine in owner:
                a, b = find(owner[engine]), find(i)
                if a != b:
                    parent[b] = a
            else:
                owner[engine] = i

    groups: dict[int, list[dict]] = {}
    for i, change in enumerate(changes):
        groups.setdefault(find(i), []).append(change)
    return list(groups.values())


def group_slug(group: list[dict]) -> str:
    """Identifiant de branche: l'extension seule, ou le moteur partage."""
    if len(group) == 1:
        return safe_ext(group[0].get("ext", ""))
    shared = set.intersection(
        *[engine_paths(c.get("paths", [])) for c in group]
    ) if any(engine_paths(c.get("paths", [])) for c in group) else set()
    if shared:
        stem = os.path.basename(sorted(shared)[0])[:-3]
        return f"{stem}-{len(group)}"
    return "-".join(safe_ext(c.get("ext", "")) for c in group)


def group_title(group: list[dict]) -> str:
    if len(group) == 1:
        return group[0]["pr_title"]
    exts = ", ".join(safe_ext(c.get("ext", "")) for c in group)
    verb = "add" if group[0].get("type") == "BUILD" else "adapt"
    return f"{'feat' if verb == 'add' else 'fix'}(scrapers): {verb} {exts}"


def group_body(group: list[dict]) -> str:
    if len(group) == 1:
        return group[0].get("pr_body", "")
    parts = []
    for change in group:
        ext = safe_ext(change.get("ext", ""))
        parts.append(f"### {ext} ({change.get('type')})\n\n"
                     + change.get("pr_body", ""))
    return "\n\n---\n\n".join(parts)


def group_paths(group: list[dict]) -> list[str]:
    seen: list[str] = []
    for change in group:
        for path in change.get("paths", []):
            if path not in seen:
                seen.append(path)
    return seen


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

    # Validation prealable de TOUS les handoffs, avant toute creation de
    # branche. Un chemin absent doit etre signale ici: decouvert plus tard,
    # au moment du `git add`, le script meurt au milieu de la boucle, la
    # liste des PRs n'est jamais ecrite, et tout le cycle est perdu alors
    # que les PRs deja creees etaient valides. On ecarte le changement
    # fautif et on continue, plutot que d'abandonner les autres.
    groups = group_changes(changes)
    skipped: list[str] = []
    usable: list[list[dict]] = []
    for group in groups:
        exts = [safe_ext(c.get("ext", "")) for c in group]
        reasons: list[tuple[str, str]] = []
        for change in group:
            ext = safe_ext(change.get("ext", ""))
            kind = change.get("type")
            if kind not in VALID_TYPES:
                reasons.append((ext, f"type inconnu {kind!r} "
                                     f"(attendu {', '.join(VALID_TYPES)})"))
                continue
            missing = [p for p in change.get("paths", [])
                       if not os.path.exists(p)]
            if missing:
                reasons.append((ext, f"fichiers absents du disque: "
                                     f"{', '.join(missing)}"))
        if reasons:
            # Un groupe est indivisible: si un de ses membres est invalide,
            # toute la PR est ecartee, car une PR autonome ne peut pas
            # embarquer la moitie d'un moteur partage.
            for ext, reason in reasons:
                print(f"SKIP: {ext}, {reason}")
                skipped.append(f"`{ext}` ({reason})")
            print(f"SKIP: groupe {', '.join(exts)} ecarte ({len(reasons)} "
                  f"membre(s) invalide(s))")
            continue
        usable.append(group)

    pr_urls: list[str] = []
    for group in usable:
        slug = group_slug(group)
        branch = f"fix/keiyoushi-{ISSUE}-{slug}"
        paths = group_paths(group)
        exts = [safe_ext(c.get("ext", "")) for c in group]
        label = exts[0] if len(exts) == 1 else f"{exts[0]} (+{len(exts) - 1})"
        title = group_title(group)
        commit_msg = f"{title} (#{ISSUE})"

        # Dedup: verifie si une PR existe deja pour cette branche (open OU merged,
        # meme si la branche a ete supprimee apres merge).
        existing_pr = run("gh", "pr", "list", "--head", branch, "--repo", REPO,
                          "--state", "all", "--json", "state,url,number",
                          "-q", "if length > 0 then .[0] | \"\\(.state)||\\(.url)||\\(.number)\" else \"\" end",
                          check=False)
        if existing_pr:
            state, _, rest = existing_pr.partition("||")
            url, _, number = rest.partition("||")
            if state == "MERGED":
                print(f"PR #{number} (branch {branch}) deja MERGED, "
                      "skip (deja soumise, rien a re-submit)")
                continue
            if state == "OPEN":
                # La branche distante appartient au pipeline : on la
                # reconstruit depuis main, ce qui la desynchronise de
                # l'existant. Un push simple echoue donc toujours en
                # non-fast-forward; il faut --force-with-lease, qui refuse
                # si quelqu'un a pousse entre-temps. Sans ce lease (et sans
                # check), le push echouait en silence et la PR gardait ses
                # anciens commits -- le symptome "correction absente de la PR".
                run("git", "fetch", "--quiet", "origin", branch, check=False)
                lease = run("git", "rev-parse", "--verify", "--quiet",
                            f"origin/{branch}", check=False)
                run("git", "branch", "-D", branch, check=False)
                run("git", "stash", "push", "-u", "-m",
                    f"keiyoushi-{ISSUE}-pending", check=False)
                run("git", "switch", "-c", branch, "main", check=False)
                run("git", "stash", "pop")
                run("git", "add", "-A", "--", *paths)
                if run("git", "diff", "--cached", "--quiet", check=False):
                    print(f"PR #{number} ({label}): rien de nouveau a pousser, "
                          "la branche est deja a jour")
                else:
                    run("git", "commit", "-m", commit_msg)
                    if lease:
                        run("git", "push", "--force-with-lease="
                            f"{branch}:{lease}", "origin", f"HEAD:{branch}")
                    else:
                        # pas de branche distante connue: push de creation
                        run("git", "push", "-u", "origin", f"HEAD:{branch}")
                run("git", "switch", "main", check=False)
                print(f"PR existante ouverte #{number} pour {label}: {url} "
                      "(branche reconstruite depuis main, force-with-lease)")
                pr_urls.append(url)
                continue
            print(f"PR #{number} (branch {branch}) etat={state}, ignoree")
            continue

        run("git", "stash", "push", "-u", "-m", f"keiyoushi-{ISSUE}-pending", check=False)
        run("git", "branch", "-D", branch, check=False)
        run("git", "switch", "-c", branch, "main")
        run("git", "stash", "pop", check=False)

        run("git", "add", "-A", "--", *paths)
        if run("git", "diff", "--cached", "--quiet", check=False):
            # Rien de neuf: le contenu annonce est deja identique sur la
            # branche (PR precedente du meme engine, ou travail deja merge).
            # On n'ouvre pas de PR vide, on le signale et on continue.
            print(f"SKIP: {label} rien a committer, le contenu est deja "
                  f"present sur la branche {branch}")
            skipped.append(f"`{label}` (rien a committer: contenu deja present)")
            run("git", "switch", "main", check=False)
            run("git", "branch", "-D", branch, check=False)
            continue
        run("git", "commit", "-m", commit_msg)
        run("git", "push", "-u", "--force", "origin", branch)

        body_file = f"/tmp/keiyoushi_pr_body_{slug}.md"
        os.makedirs(os.path.dirname(body_file) or ".", exist_ok=True)
        with open(body_file, "w", encoding="utf-8") as f:
            f.write(group_body(group))
        created = run("gh", "pr", "create", "--repo", REPO,
                      "--title", title, "--body-file", body_file, check=False)
        if not created:
            # La branche est poussee mais aucune PR n'existe: on le dit
            # explicitement plutot que de perdre le travail en silence.
            reason = f"branche {branch} poussee mais `gh pr create` a echoue"
            skipped.append(f"`{label}` ({reason})")
            print(f"SKIP: {label}, {reason}")
            continue
        print(f"PR creee pour {label}: {created}")
        pr_urls.append(created)

    pr_list = []
    for url in pr_urls:
        number = run("gh", "pr", "view", url, "--repo", REPO,
                     "--json", "number,title", "-q", r'"\(.number)||\(.title)"')
        num, _, title = number.partition("||")
        pr_list.append({"number": int(num), "title": title, "url": url})
    with open(PR_LIST_FILE, "w", encoding="utf-8") as f:
        json.dump(pr_list, f, indent=2)

    # Marqueur de cycle incomplet: merge et verify le lisent pour ne pas
    # fermer l'issue alors que des extensions n'ont pas ete soumises.
    with open(SKIPPED_FILE, "w", encoding="utf-8") as f:
        json.dump({"skipped": skipped}, f, indent=2)

    print(json.dumps({
        "ok": not skipped,
        "pr_urls": pr_urls,
        "pr_list_written": PR_LIST_FILE,
        "skipped": skipped,
    }, indent=2))


if __name__ == "__main__":
    main()
