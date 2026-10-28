import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import keiyoushi_ai_review as review
import keiyoushi_review_policy as policy

HEAD = "a" * 40


def gate(number=1, verdict="PASS", head=HEAD, checks=None, kind="code"):
    merged_checks = {"kind": kind}
    if kind == "code":
        merged_checks["exts"] = ["en/foo"]
    if checks:
        merged_checks.update(checks)
    return {
        "gate_version": 1,
        "prs": [{
            "number": number,
            "verdict": verdict,
            "head_sha": head,
            "reason": "gate reason",
            "checks": merged_checks,
        }],
    }


def ai(number: object = 1, verdict="PASS", gate_verdict="PASS", head=HEAD, **over):
    entry = {
        "number": number,
        "verdict": verdict,
        "gate_verdict": gate_verdict,
        "head_sha": head,
        "reason": "verifie",
        "live_verified": False,
        "live_evidence": "",
        "registry_ok": False,
    }
    entry.update(over)
    return {
        "review_version": 1,
        "reviewer_model": "test/model",
        "prs": [entry],
    }


class EffectiveReviewTest(unittest.TestCase):
    def test_no_ai_falls_back_to_gate(self):
        entries, source, errors = policy.effective_review(gate(), None, [1])
        self.assertEqual(source, "gate")
        self.assertEqual(errors, [])
        self.assertEqual(entries[1]["verdict"], "PASS")

    def test_present_but_unreadable_ai_blocks_gate_pass(self):
        entries, source, errors = policy.effective_review(
            gate(), None, [1], ai_present=True
        )
        self.assertEqual(source, "fallback")
        self.assertEqual(entries[1]["verdict"], "HOLD")
        self.assertTrue(any("illisible" in e for e in errors))

    def test_valid_ai_confirms_pass(self):
        entries, source, errors = policy.effective_review(
            gate(), ai(), [1]
        )
        self.assertEqual(source, "ai")
        self.assertEqual(errors, [])
        self.assertEqual(entries[1]["verdict"], "PASS")

    def test_ai_can_downgrade_gate_pass(self):
        entries, source, errors = policy.effective_review(
            gate(), ai(verdict="FAIL"), [1]
        )
        self.assertEqual(source, "ai")
        self.assertEqual(errors, [])
        self.assertEqual(entries[1]["verdict"], "FAIL")

    def test_gate_fail_is_final(self):
        entries, source, errors = policy.effective_review(
            gate(verdict="FAIL"),
            ai(
                verdict="PASS",
                gate_verdict="FAIL",
                live_verified=True,
                live_evidence="popular=1",
            ),
            [1],
        )
        self.assertEqual(source, "fallback")
        self.assertTrue(any("FAIL ne peut pas devenir" in e for e in errors))
        self.assertEqual(entries[1]["verdict"], "FAIL")

    def test_hold_pass_requires_live_evidence(self):
        entries, source, errors = policy.effective_review(
            gate(verdict="HOLD"),
            ai(verdict="PASS", gate_verdict="HOLD"),
            [1],
        )
        self.assertEqual(source, "fallback")
        self.assertTrue(any("sans live_verified" in e for e in errors))
        self.assertEqual(entries[1]["verdict"], "HOLD")

    def test_hold_pass_with_live_verified_and_evidence(self):
        entries, source, errors = policy.effective_review(
            gate(verdict="HOLD"),
            ai(
                verdict="PASS",
                gate_verdict="HOLD",
                live_verified=True,
                live_evidence="popular=24 search=8",
            ),
            [1],
        )
        self.assertEqual(source, "ai")
        self.assertEqual(errors, [])
        self.assertEqual(entries[1]["verdict"], "PASS")

    def test_hold_pass_without_evidence_falls_back(self):
        entries, source, errors = policy.effective_review(
            gate(verdict="HOLD"),
            ai(verdict="PASS", gate_verdict="HOLD", live_verified=True),
            [1],
        )
        self.assertEqual(source, "fallback")
        self.assertTrue(any("live_evidence" in e for e in errors))
        self.assertEqual(entries[1]["verdict"], "HOLD")

    def test_hold_pass_code_without_scraper_ext_stays_hold(self):
        entries, source, errors = policy.effective_review(
            gate(verdict="HOLD", checks={"exts": []}),
            ai(
                verdict="PASS",
                gate_verdict="HOLD",
                live_verified=True,
                live_evidence="popular=24 search=8",
            ),
            [1],
        )
        self.assertEqual(source, "fallback")
        self.assertTrue(any("sans extension" in e for e in errors))
        self.assertEqual(entries[1]["verdict"], "HOLD")

    def test_non_string_live_evidence_is_invalid(self):
        entries, source, errors = policy.effective_review(
            gate(),
            ai(verdict="PASS", live_evidence=1),
            [1],
        )
        self.assertEqual(source, "fallback")
        self.assertTrue(any("live_evidence doit etre un texte" in e for e in errors))
        self.assertEqual(entries[1]["verdict"], "HOLD")

    def test_hold_pass_with_registry_ok(self):
        entries, source, errors = policy.effective_review(
            gate(
                verdict="HOLD",
                kind="registry",
                checks={"registry_ok": True},
            ),
            ai(verdict="PASS", gate_verdict="HOLD", registry_ok=True),
            [1],
        )
        self.assertEqual(source, "ai")
        self.assertEqual(errors, [])
        self.assertEqual(entries[1]["verdict"], "PASS")

    def test_hold_pass_registry_ok_requires_gate_check(self):
        entries, source, errors = policy.effective_review(
            gate(
                verdict="HOLD",
                kind="registry",
                checks={"registry_ok": False},
            ),
            ai(verdict="PASS", gate_verdict="HOLD", registry_ok=True),
            [1],
        )
        self.assertEqual(source, "fallback")
        self.assertEqual(entries[1]["verdict"], "HOLD")

    def test_registry_hold_cannot_use_live_verified_alone(self):
        entries, source, errors = policy.effective_review(
            gate(
                verdict="HOLD",
                kind="registry",
                checks={"registry_ok": True},
            ),
            ai(
                verdict="PASS",
                gate_verdict="HOLD",
                live_verified=True,
                live_evidence="popular=1",
            ),
            [1],
        )
        self.assertEqual(source, "fallback")
        self.assertEqual(entries[1]["verdict"], "HOLD")

    def test_missing_ai_entry_blocks_only_gate_pass(self):
        entries, source, errors = policy.effective_review(
            {
                "gate_version": 1,
                "prs": [
                    {"number": 1, "verdict": "PASS", "head_sha": HEAD},
                    {"number": 2, "verdict": "PASS", "head_sha": HEAD},
                ],
            },
            ai(),
            [1, 2],
        )
        self.assertEqual(source, "mixed")
        self.assertEqual(entries[1]["verdict"], "PASS")
        self.assertEqual(entries[2]["verdict"], "HOLD")
        self.assertTrue(any("#2" in e for e in errors))

    def test_missing_ai_entry_preserves_gate_fail(self):
        entries, source, errors = policy.effective_review(
            {
                "gate_version": 1,
                "prs": [
                    {"number": 1, "verdict": "PASS", "head_sha": HEAD},
                    {"number": 2, "verdict": "FAIL", "head_sha": HEAD},
                ],
            },
            ai(),
            [1, 2],
        )
        self.assertEqual(source, "mixed")
        self.assertEqual(entries[1]["verdict"], "PASS")
        self.assertEqual(entries[2]["verdict"], "FAIL")

    def test_extra_ai_entry_falls_back_and_blocks_pass(self):
        data = ai()
        data["prs"].append({
            "number": 2,
            "verdict": "PASS",
            "gate_verdict": "PASS",
            "head_sha": HEAD,
            "reason": "verifie",
        })
        entries, source, errors = policy.effective_review(gate(), data, [1])
        self.assertEqual(source, "fallback")
        self.assertEqual(entries[1]["verdict"], "HOLD")
        self.assertTrue(any("hors liste" in e for e in errors))

    def test_invalid_extra_ai_entry_blocks_gate_pass(self):
        data = ai()
        data["prs"].append({
            "number": "2",
            "verdict": "PASS",
            "gate_verdict": "PASS",
            "head_sha": HEAD,
            "reason": "invalide",
        })
        entries, source, errors = policy.effective_review(gate(), data, [1])
        self.assertEqual(source, "fallback")
        self.assertEqual(entries[1]["verdict"], "HOLD")
        self.assertTrue(any("entier positif" in e for e in errors))

    def test_invalid_extra_gate_entry_blocks_gate_pass(self):
        data = gate()
        data["prs"].append({
            "number": "2",
            "verdict": "PASS",
            "head_sha": HEAD,
            "reason": "invalide",
        })
        entries, source, errors = policy.effective_review(
            data, ai(), [1]
        )
        self.assertEqual(source, "fallback")
        self.assertEqual(entries[1]["verdict"], "HOLD")
        self.assertTrue(any("entier positif" in e for e in errors))

    def test_head_mismatch_blocks_gate_pass(self):
        entries, source, errors = policy.effective_review(
            gate(), ai(head="b" * 40), [1]
        )
        self.assertEqual(source, "fallback")
        self.assertEqual(entries[1]["verdict"], "HOLD")
        self.assertTrue(any("head_sha IA" in e for e in errors))

    def test_missing_gate_head_blocks_gate_pass(self):
        entries, source, errors = policy.effective_review(
            gate(head=""), ai(), [1]
        )
        self.assertEqual(source, "fallback")
        self.assertEqual(entries[1]["verdict"], "HOLD")
        self.assertTrue(any("head_sha du gate" in e for e in errors))

    def test_invalid_gate_verdict_falls_back(self):
        entries, source, errors = policy.effective_review(
            gate(verdict="BROKEN"), ai(gate_verdict="BROKEN"), [1]
        )
        self.assertEqual(source, "fallback")
        self.assertEqual(entries, {})
        self.assertTrue(any("verdict du gate inconnu" in e for e in errors))

    def test_gate_verdict_mismatch_falls_back(self):
        entries, source, errors = policy.effective_review(
            gate(verdict="HOLD"),
            ai(verdict="HOLD", gate_verdict="PASS"),
            [1],
        )
        self.assertEqual(source, "fallback")
        self.assertEqual(entries[1]["verdict"], "HOLD")
        self.assertTrue(any("gate_verdict" in e for e in errors))

    def test_empty_reason_blocks_gate_pass(self):
        entries, source, errors = policy.effective_review(
            gate(), ai(reason="  "), [1]
        )
        self.assertEqual(source, "fallback")
        self.assertEqual(entries[1]["verdict"], "HOLD")
        self.assertTrue(any("reason IA vide" in e for e in errors))

    def test_numeric_reason_blocks_gate_pass(self):
        entries, source, errors = policy.effective_review(
            gate(), ai(reason=123), [1]
        )
        self.assertEqual(source, "fallback")
        self.assertEqual(entries[1]["verdict"], "HOLD")
        self.assertTrue(any("non textuelle" in e for e in errors))

    def test_wrong_review_version_blocks_gate_pass(self):
        data = ai()
        data["review_version"] = 2
        entries, source, errors = policy.effective_review(gate(), data, [1])
        self.assertEqual(source, "fallback")
        self.assertEqual(entries[1]["verdict"], "HOLD")
        self.assertTrue(any("review_version" in e for e in errors))

    def test_bool_review_version_is_rejected(self):
        data = ai()
        data["review_version"] = True
        entries, source, errors = policy.effective_review(gate(), data, [1])
        self.assertEqual(source, "fallback")
        self.assertEqual(entries[1]["verdict"], "HOLD")
        self.assertTrue(any("review_version" in e for e in errors))

    def test_float_pr_number_is_rejected(self):
        data = ai(number=1.9)
        entries, source, errors = policy.effective_review(gate(), data, [1])
        self.assertEqual(source, "fallback")
        self.assertEqual(entries[1]["verdict"], "HOLD")
        self.assertTrue(any("entier positif" in e for e in errors))

    def test_duplicate_ai_entries_are_rejected(self):
        data = ai()
        data["prs"].append({
            "number": 1,
            "verdict": "PASS",
            "gate_verdict": "PASS",
            "head_sha": HEAD,
            "reason": "second",
        })
        entries, source, errors = policy.effective_review(gate(), data, [1])
        self.assertEqual(source, "fallback")
        self.assertEqual(entries[1]["verdict"], "HOLD")
        self.assertTrue(any("duplique" in e for e in errors))

    def test_invalid_ai_head_is_rejected(self):
        entries, source, errors = policy.effective_review(
            gate(), ai(head="not-a-sha"), [1]
        )
        self.assertEqual(source, "fallback")
        self.assertEqual(entries[1]["verdict"], "HOLD")
        self.assertTrue(any("head_sha IA invalide" in e for e in errors))

    def test_gate_entries_reject_bool_version(self):
        data = gate()
        data["gate_version"] = True
        self.assertEqual(policy.gate_entries(data), {})


class RunnerParsingTest(unittest.TestCase):
    def test_load_flexible_json_accepts_code_fence(self):
        payload = {"review_version": 1, "prs": []}
        with tempfile.NamedTemporaryFile(
            "w", suffix=".json", delete=False, encoding="utf-8"
        ) as handle:
            handle.write("```json\n" + json.dumps(payload) + "\n```\n")
            path = handle.name
        try:
            self.assertEqual(review.load_flexible_json(path), payload)
        finally:
            os.unlink(path)

    def test_load_flexible_json_rejects_garbage(self):
        with tempfile.NamedTemporaryFile(
            "w", suffix=".json", delete=False, encoding="utf-8"
        ) as handle:
            handle.write("not json")
            path = handle.name
        try:
            self.assertIsNone(review.load_flexible_json(path))
        finally:
            os.unlink(path)

    def test_pr_numbers_rejects_float_and_bool(self):
        data = [
            {"number": 1},
            {"number": 2.5},
            {"number": True},
            {"number": "3"},
            {"number": 4},
        ]
        with tempfile.NamedTemporaryFile(
            "w", suffix=".json", delete=False, encoding="utf-8"
        ) as handle:
            json.dump(data, handle)
            path = handle.name
        try:
            with mock.patch.object(review, "PR_LIST_FILE", path):
                self.assertEqual(review.pr_numbers(), [1, 4])
        finally:
            os.unlink(path)

    def test_normalize_review_caps_reason(self):
        data = {"prs": [{"number": 1, "reason": "x" * 5000}]}
        normalized = review.normalize_review(data)
        self.assertEqual(len(normalized["prs"][0]["reason"]), 4000)

    def test_child_env_removes_write_surfaces(self):
        env = {
            "GITHUB_ENV": "/tmp/env",
            "GITHUB_PATH": "/tmp/path",
            "ACTIONS_RUNTIME_TOKEN": "runtime",
            "GOOGLE_GENERATIVE_AI_API_KEY": "secret",
        }
        with mock.patch.dict(os.environ, env, clear=True):
            child = review.child_env("opencode/model")
            self.assertNotIn("GITHUB_ENV", child)
            self.assertNotIn("GITHUB_PATH", child)
            self.assertNotIn("ACTIONS_RUNTIME_TOKEN", child)
            self.assertNotIn("GOOGLE_GENERATIVE_AI_API_KEY", child)
            google = review.child_env("google/gemini")
            self.assertEqual(
                google.get("GOOGLE_GENERATIVE_AI_API_KEY"), "secret"
            )


class ModelChainTest(unittest.TestCase):
    def test_uses_all_agent_slots_and_deduplicates(self):
        env = {
            "PRIMARY_MODEL": "primary",
            "FALLBACK_MODEL": "fallback",
            "GEMINI_MODEL": "google/gemini",
            "FALLBACK3_MODEL": "primary",
            "FALLBACK4_MODEL": "last",
        }
        with mock.patch.dict(os.environ, env, clear=True):
            self.assertEqual(
                review.model_chain(),
                ["primary", "fallback", "google/gemini", "last"],
            )

    def test_explicit_override(self):
        with mock.patch.dict(
            os.environ, {"REVIEW_MODELS": "one, two,one"}, clear=True
        ):
            self.assertEqual(review.model_chain(), ["one", "two"])

    def test_gemini_uses_auto_without_variant_flags(self):
        command = review.build_command("/bin/opencode", "google/gemini")
        self.assertIn("--auto", command)
        self.assertNotIn("--variant", command)
        self.assertNotIn("--thinking", command)

    def test_other_models_use_max_thinking(self):
        command = review.build_command("/bin/opencode", "opencode/model")
        self.assertIn("--variant", command)
        self.assertIn("max", command)
        self.assertIn("--thinking", command)
        self.assertIn("--auto", command)


if __name__ == "__main__":
    unittest.main()
