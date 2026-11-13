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
    merged_checks: dict[str, object] = {"kind": kind}
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
        with mock.patch.object(review, "COMPACT", False):
            normalized = review.normalize_review(data)
        self.assertEqual(len(normalized["prs"][0]["reason"]), 4000)

    def test_normalize_review_caps_reason_in_compact_mode(self):
        data = {"prs": [{"number": 1, "reason": "x" * 5000}]}
        with mock.patch.multiple(
            review, COMPACT=True, COMPACT_REASON_MAX=700
        ):
            normalized = review.normalize_review(data)
        self.assertEqual(len(normalized["prs"][0]["reason"]), 700)

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


class StatusTest(unittest.TestCase):
    def test_write_status_writes_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "status.json")
            with mock.patch.object(review, "AI_REVIEW_STATUS_FILE", path):
                review.write_status(
                    "unavailable", "all models failed", ["model: rc=124"]
                )
            with open(path, encoding="utf-8") as handle:
                data = json.load(handle)
            self.assertEqual(data["status"], "unavailable")
            self.assertEqual(data["reason"], "all models failed")
            self.assertEqual(data["attempts"], ["model: rc=124"])

    def test_advisory_exit_code(self):
        with mock.patch.object(review, "AI_REVIEW_ADVISORY", True):
            self.assertEqual(review.advisory_exit_code(1), 0)
        with mock.patch.object(review, "AI_REVIEW_ADVISORY", False):
            self.assertEqual(review.advisory_exit_code(1), 1)


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

    def test_command_points_to_bundle_and_partial_file(self):
        command = review.build_command("/bin/opencode", "opencode/model")
        joined = " ".join(command)
        self.assertIn(review.AI_REVIEW_BUNDLE_FILE, joined)
        self.assertIn(review.AI_REVIEW_PARTIAL_FILE, joined)
        self.assertNotIn(review.AI_REVIEW_FILE, joined)

    def test_command_carries_adaptive_time_budget(self):
        command = review.build_command(
            "/bin/opencode", "opencode/model", budget_s=420
        )
        joined = " ".join(command)
        self.assertIn("420 seconds", joined)


class RunnerFlowTest(unittest.TestCase):
    def test_gate_fail_is_synthesized_and_not_sent_to_model(self):
        with tempfile.TemporaryDirectory() as tmp:
            def path(name):
                return os.path.join(tmp, name)

            pr_path = path("prs.json")
            gate_path = path("gate.json")
            handoff_path = path("handoff.json")
            prompt_path = path("prompt.md")
            final_path = path("ai.json")
            partial_path = path("partial.json")
            bundle_path = path("bundle.json")
            status_path = path("status.json")
            log_path = path("model.log")
            with open(pr_path, "w", encoding="utf-8") as handle:
                json.dump([
                    {"number": 1, "title": "one", "url": "u1"},
                    {"number": 2, "title": "two", "url": "u2"},
                    {"number": 3, "title": "three", "url": "u3"},
                ], handle)
            with open(gate_path, "w", encoding="utf-8") as handle:
                json.dump({
                    "gate_version": 1,
                    "prs": [
                        {
                            "number": 1, "verdict": "PASS", "head_sha": HEAD,
                            "reason": "ok", "checks": {"kind": "code"},
                        },
                        {
                            "number": 2, "verdict": "FAIL", "head_sha": HEAD,
                            "reason": "bad", "checks": {"kind": "code"},
                        },
                        {
                            "number": 3, "verdict": "HOLD", "head_sha": HEAD,
                            "reason": "maybe", "checks": {"kind": "code"},
                        },
                    ],
                }, handle)
            with open(handoff_path, "w", encoding="utf-8") as handle:
                json.dump({"close": False, "summary_md": "summary"}, handle)
            with open(prompt_path, "w", encoding="utf-8") as handle:
                handle.write("prompt")
            with open(log_path, "w", encoding="utf-8") as handle:
                handle.write("log")

            def fake_bundle(reviewable, gate_map, metadata, handoff):
                self.assertEqual(reviewable, [1, 3])
                self.assertNotIn(2, reviewable)
                return ({
                    "bundle_version": 1,
                    "reviewable_prs": [
                        {"number": 1, "gate": gate_map[1], "diff": "d1"},
                        {"number": 3, "gate": gate_map[3], "diff": "d3"},
                    ],
                }, {})

            def fake_run(opencode, model, timeout, grace=0):
                with open(partial_path, "w", encoding="utf-8") as handle:
                    json.dump({
                        "review_version": 1,
                        "prs": [
                            ai(number=1)["prs"][0],
                            ai(
                                number=3,
                                verdict="HOLD",
                                gate_verdict="HOLD",
                            )["prs"][0],
                        ],
                    }, handle)
                return 0, log_path

            patches = {
                "PR_LIST_FILE": pr_path,
                "GATE_REVIEW_FILE": gate_path,
                "HANDOFF_FILE": handoff_path,
                "PROMPT_FILE": prompt_path,
                "AI_REVIEW_FILE": final_path,
                "AI_REVIEW_PARTIAL_FILE": partial_path,
                "AI_REVIEW_BUNDLE_FILE": bundle_path,
                "AI_REVIEW_STATUS_FILE": status_path,
                "AI_REVIEW_ADVISORY": False,
            }
            with mock.patch.multiple(review, **patches), \
                    mock.patch.object(
                        review, "build_review_bundle", side_effect=fake_bundle
                    ), \
                    mock.patch.object(
                        review, "run_model", side_effect=fake_run
                    ), \
                    mock.patch.object(
                        review, "model_chain", return_value=["test/model"]
                    ), \
                    mock.patch.object(
                        review, "opencode_bin", return_value="/bin/opencode"
                    ):
                code = review.main()

            self.assertEqual(code, 0)
            with open(final_path, encoding="utf-8") as handle:
                final = json.load(handle)
            verdicts = {
                entry["number"]: entry["verdict"]
                for entry in final["prs"]
            }
            self.assertEqual(verdicts, {1: "PASS", 2: "FAIL", 3: "HOLD"})
            self.assertEqual(final["reviewer_model"], "test/model")

    def test_valid_partial_is_used_even_if_process_timed_out(self):
        with tempfile.TemporaryDirectory() as tmp:
            def path(name):
                return os.path.join(tmp, name)

            pr_path = path("prs.json")
            gate_path = path("gate.json")
            handoff_path = path("handoff.json")
            prompt_path = path("prompt.md")
            final_path = path("ai.json")
            partial_path = path("partial.json")
            bundle_path = path("bundle.json")
            status_path = path("status.json")
            log_path = path("model.log")
            with open(pr_path, "w", encoding="utf-8") as handle:
                json.dump([{"number": 1, "title": "one", "url": "u1"}], handle)
            with open(gate_path, "w", encoding="utf-8") as handle:
                json.dump(gate(number=1), handle)
            with open(handoff_path, "w", encoding="utf-8") as handle:
                json.dump({"close": False, "summary_md": "summary"}, handle)
            with open(prompt_path, "w", encoding="utf-8") as handle:
                handle.write("prompt")
            with open(log_path, "w", encoding="utf-8") as handle:
                handle.write("partial written before timeout")

            def fake_bundle(reviewable, gate_map, metadata, handoff):
                return ({
                    "bundle_version": 1,
                    "reviewable_prs": [{
                        "number": 1,
                        "gate": gate_map[1],
                        "diff": "d1",
                    }],
                }, {})

            def fake_run(opencode, model, timeout, grace=0):
                with open(partial_path, "w", encoding="utf-8") as handle:
                    json.dump(ai(number=1), handle)
                return 124, log_path

            patches = {
                "PR_LIST_FILE": pr_path,
                "GATE_REVIEW_FILE": gate_path,
                "HANDOFF_FILE": handoff_path,
                "PROMPT_FILE": prompt_path,
                "AI_REVIEW_FILE": final_path,
                "AI_REVIEW_PARTIAL_FILE": partial_path,
                "AI_REVIEW_BUNDLE_FILE": bundle_path,
                "AI_REVIEW_STATUS_FILE": status_path,
                "AI_REVIEW_ADVISORY": False,
            }
            with mock.patch.multiple(review, **patches), \
                    mock.patch.object(
                        review, "build_review_bundle", side_effect=fake_bundle
                    ), \
                    mock.patch.object(
                        review, "run_model", side_effect=fake_run
                    ), \
                    mock.patch.object(
                        review, "model_chain", return_value=["test/model"]
                    ), \
                    mock.patch.object(
                        review, "opencode_bin", return_value="/bin/opencode"
                    ):
                code = review.main()

            self.assertEqual(code, 0)
            with open(final_path, encoding="utf-8") as handle:
                final = json.load(handle)
            self.assertEqual(final["prs"][0]["verdict"], "PASS")
            self.assertEqual(final["reviewer_model"], "test/model")


    def test_partial_verdicts_survive_to_the_next_model(self):
        with tempfile.TemporaryDirectory() as tmp:
            def path(name):
                return os.path.join(tmp, name)

            pr_path = path("prs.json")
            gate_path = path("gate.json")
            handoff_path = path("handoff.json")
            prompt_path = path("prompt.md")
            final_path = path("ai.json")
            partial_path = path("partial.json")
            bundle_path = path("bundle.json")
            status_path = path("status.json")
            log_path = path("model.log")
            with open(pr_path, "w", encoding="utf-8") as handle:
                json.dump([
                    {"number": 1, "title": "one", "url": "u1"},
                    {"number": 2, "title": "two", "url": "u2"},
                ], handle)
            with open(gate_path, "w", encoding="utf-8") as handle:
                json.dump({
                    "gate_version": 1,
                    "prs": [
                        {
                            "number": 1, "verdict": "PASS", "head_sha": HEAD,
                            "reason": "ok", "checks": {"kind": "code"},
                        },
                        {
                            "number": 2, "verdict": "PASS", "head_sha": HEAD,
                            "reason": "ok", "checks": {"kind": "code"},
                        },
                    ],
                }, handle)
            with open(handoff_path, "w", encoding="utf-8") as handle:
                json.dump({"close": False, "summary_md": "summary"}, handle)
            with open(prompt_path, "w", encoding="utf-8") as handle:
                handle.write("prompt")
            with open(log_path, "w", encoding="utf-8") as handle:
                handle.write("log")

            def fake_bundle(reviewable, gate_map, metadata, handoff):
                return ({
                    "bundle_version": 1,
                    "reviewable_prs": [
                        {"number": 1, "gate": gate_map[1], "diff": "d1"},
                        {"number": 2, "gate": gate_map[2], "diff": "d2"},
                    ],
                }, {})

            def fake_run(opencode, model, timeout, grace=0):
                number = 1 if model == "m1" else 2
                with open(partial_path, "w", encoding="utf-8") as handle:
                    json.dump(ai(number=number), handle)
                return (124 if model == "m1" else 0), log_path

            patches = {
                "PR_LIST_FILE": pr_path,
                "GATE_REVIEW_FILE": gate_path,
                "HANDOFF_FILE": handoff_path,
                "PROMPT_FILE": prompt_path,
                "AI_REVIEW_FILE": final_path,
                "AI_REVIEW_PARTIAL_FILE": partial_path,
                "AI_REVIEW_BUNDLE_FILE": bundle_path,
                "AI_REVIEW_STATUS_FILE": status_path,
                "AI_REVIEW_ADVISORY": False,
            }
            with mock.patch.multiple(review, **patches), \
                    mock.patch.object(
                        review, "build_review_bundle", side_effect=fake_bundle
                    ), \
                    mock.patch.object(
                        review, "run_model", side_effect=fake_run
                    ), \
                    mock.patch.object(
                        review, "model_chain", return_value=["m1", "m2"]
                    ), \
                    mock.patch.object(
                        review, "opencode_bin", return_value="/bin/opencode"
                    ):
                code = review.main()

            self.assertEqual(code, 0)
            with open(final_path, encoding="utf-8") as handle:
                final = json.load(handle)
            verdicts = {
                entry["number"]: entry["verdict"]
                for entry in final["prs"]
            }
            self.assertEqual(verdicts, {1: "PASS", 2: "PASS"})
            self.assertEqual(final["reviewer_model"], "m2")


class AdaptiveBudgetTest(unittest.TestCase):
    def test_workload_stats_counts_diffs_and_handoff(self):
        bundle = {
            "reviewable_prs": [
                {"diff": "a" * 100},
                {"diff": "b" * 50},
                {"diff": ""},
            ],
            "handoff": {"summary_md": "c" * 10},
        }
        stats = review.workload_stats(bundle)
        self.assertEqual(stats["pr_count"], 3)
        self.assertEqual(stats["diff_chars"], 150)
        self.assertEqual(stats["handoff_chars"], 10)
        self.assertEqual(stats["total_chars"], 160)

    def test_estimate_model_timeout_scales_with_workload(self):
        with mock.patch.multiple(
            review,
            MODEL_TIMEOUT_MIN_S=180,
            MODEL_TIMEOUT_MAX_S=1200,
            BASE_SECONDS=90,
            SECONDS_PER_DIFF_CHAR=0.008,
            SECONDS_PER_PR=25,
        ):
            small = review.estimate_model_timeout(
                {"pr_count": 1, "total_chars": 1000}
            )
            large = review.estimate_model_timeout(
                {"pr_count": 10, "total_chars": 200000}
            )
        self.assertEqual(small, 180)
        self.assertEqual(large, 1200)

    def test_estimate_total_deadline_reserves_attempts_and_caps(self):
        with mock.patch.object(review, "TOTAL_DEADLINE_S", 2400):
            self.assertEqual(review.estimate_total_deadline(5, 300), 1020)
            self.assertEqual(review.estimate_total_deadline(5, 1200), 2400)

    def test_extract_valid_entries_ignores_invalid_and_extra_entries(self):
        gate_map = {
            1: {"number": 1, "verdict": "PASS", "head_sha": HEAD},
            2: {"number": 2, "verdict": "PASS", "head_sha": HEAD},
        }
        data = {
            "review_version": 1,
            "prs": [
                ai(number=1)["prs"][0],
                ai(number=True)["prs"][0],
                ai(number=2, head="b" * 40)["prs"][0],
                ai(number=3)["prs"][0],
            ],
        }
        accepted = review.extract_valid_entries(
            data, gate_map, [1, 2]
        )
        self.assertEqual(list(accepted), [1])
        self.assertTrue(all(type(number) is int for number in accepted))

    def test_build_review_bundle_allocates_fair_per_pr_budget(self):
        budgets = []

        def fake_fetch(number, budget):
            budgets.append(budget)
            return "d" * budget, False, ""

        with mock.patch.multiple(
            review,
            MAX_DIFF_CHARS=12000,
            MAX_TOTAL_DIFF_CHARS=30000,
            MIN_DIFF_CHARS=2000,
        ), mock.patch.object(
            review, "fetch_pr_diff", side_effect=fake_fetch
        ):
            bundle, holds = review.build_review_bundle(
                list(range(1, 11)),
                {n: {"verdict": "PASS", "head_sha": HEAD} for n in range(1, 11)},
                {},
                {},
            )
        self.assertEqual(holds, {})
        self.assertEqual(len(bundle["reviewable_prs"]), 10)
        self.assertEqual(budgets, [3000] * 10)
        self.assertEqual(
            sum(len(item["diff"]) for item in bundle["reviewable_prs"]),
            30000,
        )


class GateSynthesisTest(unittest.TestCase):
    @staticmethod
    def entry(number, verdict):
        return {
            "number": number,
            "verdict": verdict,
            "head_sha": HEAD,
            "reason": "gate reason",
            "checks": {"kind": "code", "exts": ["en/foo"]},
        }

    def test_split_synthesizes_fail_and_keeps_pass_hold(self):
        gate_map = {
            1: self.entry(1, "PASS"),
            2: self.entry(2, "FAIL"),
            3: self.entry(3, "HOLD"),
        }
        failed, reviewable, unknown = review.split_gate_verdicts(
            [1, 2, 3], gate_map
        )
        self.assertEqual(list(failed), [2])
        self.assertEqual(failed[2]["verdict"], "FAIL")
        self.assertEqual(failed[2]["gate_verdict"], "FAIL")
        self.assertIn("final", failed[2]["reason"])
        self.assertEqual(reviewable, [1, 3])
        self.assertEqual(unknown, [])

    def test_split_reports_unknown_gate_verdict(self):
        gate_map = {1: self.entry(1, "BROKEN")}
        failed, reviewable, unknown = review.split_gate_verdicts([1], gate_map)
        self.assertEqual(failed, {})
        self.assertEqual(reviewable, [])
        self.assertEqual(unknown, [1])

    def test_merge_review_entries_combines_synth_and_model(self):
        synthesized = {2: review.synthesize_fail(self.entry(2, "FAIL"))}
        partial = ai(number=1)
        merged = review.merge_review_entries(synthesized, partial)
        self.assertEqual([entry["number"] for entry in merged], [1, 2])
        self.assertEqual(merged[0]["verdict"], "PASS")
        self.assertEqual(merged[1]["verdict"], "FAIL")

    def test_trim_diff_marks_truncation(self):
        text, truncated = review.trim_diff("a" * 200, 80)
        self.assertTrue(truncated)
        self.assertLessEqual(len(text), 80)
        self.assertIn("TRUNCATED", text)

    def test_finalize_fallback_holds_reviewable_and_keeps_fail(self):
        gate_data = {
            "gate_version": 1,
            "prs": [
                self.entry(1, "PASS"),
                self.entry(2, "FAIL"),
            ],
        }
        synthesized = {2: review.synthesize_fail(self.entry(2, "FAIL"))}
        with tempfile.TemporaryDirectory() as tmp:
            final_path = os.path.join(tmp, "ai.json")
            status_path = os.path.join(tmp, "status.json")
            with mock.patch.object(review, "AI_REVIEW_FILE", final_path), \
                    mock.patch.object(
                        review, "AI_REVIEW_STATUS_FILE", status_path
                    ), \
                    mock.patch.object(review, "AI_REVIEW_ADVISORY", True):
                code = review.finalize_fallback(
                    "tous les modeles ont echoue",
                    synthesized,
                    [1],
                    gate_data,
                    [1, 2],
                    ["model: rc=124"],
                )
            self.assertEqual(code, 0)
            with open(final_path, encoding="utf-8") as handle:
                final = json.load(handle)
            verdicts = {
                entry["number"]: entry["verdict"]
                for entry in final["prs"]
            }
            self.assertEqual(verdicts, {1: "HOLD", 2: "FAIL"})
            self.assertEqual(final["reviewer_model"], "deterministic-fallback")
            with open(status_path, encoding="utf-8") as handle:
                status = json.load(handle)
            self.assertEqual(status["status"], "unavailable")
            self.assertEqual(
                status["reviewer_model"], "deterministic-fallback"
            )


if __name__ == "__main__":
    unittest.main()
