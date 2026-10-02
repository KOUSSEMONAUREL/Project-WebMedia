#!/usr/bin/env python3
"""Tests de la validation de handoff de keiyoushi_submit.

L'invariant central: le registre (`SOURCES_NON_SCRAPPABLES.md`) est une
decision durable de site, il voyage donc toujours seul dans sa propre PR.
Ces tests verrouillent les deux moities de cette regle.

Lancement: python3 -m unittest discover -s scrapers/webtoons/sync -p 'test_*.py'
"""

import os
import sys
import unittest

# `keiyoushi_submit` lit ISSUE_NUMBER a l'import (il est fourni par le runner
# GitHub Actions). On pose une valeur de test pour que le module soit
# importable hors CI; aucune de ces valeurs n'est utilisee par validate_group.
os.environ.setdefault("ISSUE_NUMBER", "0")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import keiyoushi_submit as ks  # noqa: E402


REGISTRY = ks.REGISTRY_FILE

# Les chemins des handoffs sont relatifs a la racine du depot, comme en
# production (le runner GitHub Actions s'execute a la racine). Sans cela le
# resultat des tests depend du repertoire d'invocation: depuis
# `scrapers/webtoons/`, `os.path.exists("scrapers/webtoons/...")` echoue et
# tous les tests « registre seul » cassent alors que le code est correct.
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__)))))


def change(**over):
    """Fixture de handoff complete: les champs absents sont valides par defaut."""
    base = {
        "ext": "all/baobua",
        "type": "REGISTRY_RECHECK",
        "paths": [REGISTRY],
        "commit_msg": "docs: recheck",
        "pr_title": "docs(scrapers): recheck",
        "pr_body": "verdict",
    }
    base.update(over)
    return base


class TestValidateGroup(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._cwd = os.getcwd()
        os.chdir(REPO_ROOT)

    @classmethod
    def tearDownClass(cls):
        os.chdir(cls._cwd)

    def test_registry_recheck_alone_is_valid(self):
        self.assertEqual(ks.validate_group([change()]), [])

    def test_registry_recheck_rejects_engine_path(self):
        group = [change(paths=[REGISTRY, "scrapers/webtoons/engine/foo.ts"])]
        reasons = ks.validate_group(group)
        self.assertTrue(any("ne peut porter que" in r for _, r in reasons), reasons)

    def test_build_may_not_carry_the_registry(self):
        # Le cas inverse du precedent: porter le registre depuis un BUILD
        # ferait relire un verdict de site comme un changement de moteur.
        group = [change(type="BUILD", paths=[REGISTRY])]
        reasons = ks.validate_group(group)
        self.assertTrue(any("seul REGISTRY_RECHECK" in r for _, r in reasons),
                        reasons)

    def test_unknown_type_is_rejected(self):
        group = [change(type="NOPE")]
        reasons = ks.validate_group(group)
        self.assertTrue(any("type inconnu" in r for _, r in reasons), reasons)

    def test_missing_file_is_rejected(self):
        group = [change(paths=["does/not/exist.md"])]
        reasons = ks.validate_group(group)
        self.assertTrue(any("absents du disque" in r for _, r in reasons), reasons)

    def test_empty_paths_is_rejected(self):
        # Sans chemin, le commit n'aurait rien a porter: la PR serait vide.
        group = [change(paths=[])]
        reasons = ks.validate_group(group)
        self.assertTrue(any("aucun fichier liste" in r for _, r in reasons),
                        reasons)

    def test_registry_not_grouped_with_scraper(self):
        group = [change(), change(ext="all/x", type="BUILD",
                                  paths=["a/b.ts"])]
        reasons = ks.validate_group(group)
        self.assertTrue(any("groupe avec un autre" in r for _, r in reasons),
                        reasons)


class TestSplitAndTitle(unittest.TestCase):
    def test_registry_is_split_from_scrapers(self):
        changes = [
            change(ext="all/baobua"),
            change(ext="all/ono"),
            change(ext="all/japscan", type="BUILD", paths=["scrapers/a.ts"]),
        ]
        groups = ks.split_registry_changes(changes)
        registry_groups = [g for g in groups
                           if ks.is_registry_group(g)]
        self.assertEqual(len(registry_groups), 1)
        self.assertEqual(len(registry_groups[0]), 2)
        self.assertEqual(len(groups), 2)

    def test_single_registry_title_uses_agent_pr_title(self):
        # Une seule entree: l'agent redige un titre qui nomme le verdict.
        group = [change(ext="all/ono", pr_title="docs: ono is alive")]
        self.assertEqual(ks.group_title(group), "docs: ono is alive")

    def test_multi_registry_title_lists_exts(self):
        title = ks.group_title([change(ext="all/baobua"),
                                change(ext="all/ono")])
        self.assertEqual(
            title,
            "docs(scrapers): update non-scrapable registry for "
            "baobua, ono")

    def test_registry_label_keeps_registry_scope(self):
        label = ks.registry_label([change(ext="all/ono")])
        self.assertTrue(label.startswith("SOURCES_NON_SCRAPPABLES"), label)
        self.assertIn("ono", label)

    def test_registry_label_refuses_scraper_group(self):
        with self.assertRaises(ValueError):
            ks.registry_label([change(type="BUILD", paths=["scrapers/a.ts"])])


if __name__ == "__main__":
    unittest.main()