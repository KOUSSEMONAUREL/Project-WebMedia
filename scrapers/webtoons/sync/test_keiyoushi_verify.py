#!/usr/bin/env python3
"""Tests de la verification finale keiyoushi.

Le cas regression: un handoff peut fermer une passe entierement no-op sans
PR. Le verify doit accepter ce cas uniquement quand les no-ops sont declares,
tout en continuant a echouer sur un changement annonce mais non soumis.
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import keiyoushi_verify as kv  # noqa: E402


def cp(stdout="", returncode=0):
    return subprocess.CompletedProcess([], returncode, stdout, "")


class TestVerifyNoops(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.handoff = os.path.join(self.tmp.name, "handoff.json")
        self.prs = os.path.join(self.tmp.name, "prs.json")
        self.skipped = os.path.join(self.tmp.name, "skipped.json")
        self.issue_body = "| CRITIQUE | all/webtoons | test |\n"
        self.summary = "| all/webtoons | CRITIQUE | NO_IMPACT | filtre |\n"
        self._write(self.prs, [])
        self._write(self.skipped, {"skipped": [], "noops": []})

    @staticmethod
    def _write(path, value):
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(value, handle)

    def _run(self):
        def fake_gh(*args):
            if args[:2] == ("issue", "view"):
                field = args[args.index("--json") + 1]
                if field == "state":
                    return cp("OPEN\n")
                if field == "body":
                    return cp(self.issue_body)
            return cp("", 1)

        with mock.patch.object(kv, "ISSUE", "698"), \
                mock.patch.object(kv, "HANDOFF", self.handoff), \
                mock.patch.object(kv, "PR_LIST_FILE", self.prs), \
                mock.patch.object(kv, "SKIPPED_FILE", self.skipped), \
                mock.patch.object(kv, "gh", side_effect=fake_gh), \
                mock.patch.object(kv, "comment_issue") as comment:
            kv.main()
        return comment

    def test_close_true_with_declared_noop_and_no_pr_is_ok(self):
        self._write(self.handoff, {
            "issue": 698,
            "close": True,
            "summary_md": self.summary,
            "changes": [],
        })
        self._write(self.skipped, {
            "skipped": [],
            "noops": [{"ext": "webtoons", "reason": "NO_IMPACT: filtre"}],
        })
        comment = self._run()
        comment.assert_not_called()

    def test_claimed_change_without_pr_still_fails(self):
        self._write(self.handoff, {
            "issue": 698,
            "close": True,
            "summary_md": self.summary,
            "changes": [{"ext": "webtoons", "type": "ADAPT", "paths": []}],
        })
        self._write(self.skipped, {
            "skipped": ["`webtoons` (handoff ADAPT sans aucun diff vs main)"],
            "noops": [],
        })
        with self.assertRaises(SystemExit) as raised:
            self._run()
        self.assertEqual(raised.exception.code, 1)


if __name__ == "__main__":
    unittest.main()
