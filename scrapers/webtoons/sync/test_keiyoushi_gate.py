import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))

import keiyoushi_gate as gate


class NormalizeBaseUrlTest(unittest.TestCase):
    def test_strips_www_and_trailing_slash(self):
        self.assertEqual(
            gate.normalize_base_url("https://www.Example.com/"),
            "https://example.com",
        )

    def test_keeps_scheme(self):
        self.assertEqual(
            gate.normalize_base_url("http://example.com"),
            "http://example.com",
        )


class ScopeTest(unittest.TestCase):
    def test_allowed_paths(self):
        self.assertTrue(gate.is_allowed_path(
            "scrapers/webtoons/definitions/webtoons/fr/foo.ts"))
        self.assertTrue(gate.is_allowed_path(
            "scrapers/webtoons/engine/foo.ts"))
        self.assertTrue(gate.is_allowed_path(gate.REGISTRY))

    def test_forbidden_paths(self):
        for path in (
            ".github/workflows/keiyoushi-monitor.yml",
            "scrapers/webtoons/sync/keiyoushi_merge.py",
            "scrapers/webtoons/package.json",
            "scrapers/webtoons/tests/gate_scraper.ts",
        ):
            self.assertFalse(gate.is_allowed_path(path), path)

    def test_registry_mixed_with_code_fails(self):
        files = [
            ("added", gate.REGISTRY),
            ("added", "scrapers/webtoons/definitions/webtoons/fr/foo.ts"),
        ]
        kind, reasons = gate.evaluate_scope(files, [])
        self.assertEqual(kind, "registry")
        self.assertTrue(any("mixes" in reason for reason in reasons))

    def test_paths_outside_handoff_fail(self):
        path = "scrapers/webtoons/definitions/webtoons/fr/foo.ts"
        files = [("added", path)]
        _, reasons = gate.evaluate_scope(files, [{"paths": ["other.ts"]}])
        self.assertTrue(any("outside handoff" in reason for reason in reasons))

    def test_paths_inside_handoff_pass(self):
        path = "scrapers/webtoons/definitions/webtoons/fr/foo.ts"
        files = [("added", path)]
        kind, reasons = gate.evaluate_scope(files, [{"paths": [path]}])
        self.assertEqual(kind, "code")
        self.assertEqual(reasons, [])


class SecurityTest(unittest.TestCase):
    def test_secret_detected(self):
        reasons = gate.scan_added_lines(["const token = 'ghp_" + "a" * 30 + "';"])
        self.assertTrue(any("secret-like" in reason for reason in reasons))

    def test_dangerous_api_detected(self):
        reasons = gate.scan_added_lines(["import { exec } from 'child_process';"])
        self.assertTrue(any("forbidden API" in reason for reason in reasons))

    def test_clean_line_passes(self):
        self.assertEqual(
            gate.scan_added_lines(["const url = 'https://example.com';"]),
            [],
        )


class UpstreamTest(unittest.TestCase):
    def test_parse_assignment(self):
        text = 'baseUrl = "https://example.com"\n'
        self.assertEqual(gate.parse_upstream_base_url(text), "https://example.com")

    def test_parse_block(self):
        text = 'baseUrl {\n  "https://example.com"\n}\n'
        self.assertEqual(gate.parse_upstream_base_url(text), "https://example.com")

    def test_missing(self):
        self.assertIsNone(gate.parse_upstream_base_url("name = 'x'"))


class RegistryTest(unittest.TestCase):
    row = (
        "| `foo` | `foo.example` | IGNORE | Domaine expiré | "
        "Revérifier au prochain audit |"
    )

    @mock.patch.object(gate, "probe_url", return_value="NON (HTTP 404)")
    def test_valid_row_passes(self, _probe):
        verdict, reason, probes = gate.evaluate_registry([self.row], [])
        self.assertEqual(verdict, "PASS")
        self.assertIn("registry", reason)
        self.assertEqual(len(probes or []), 1)

    @mock.patch.object(gate, "probe_url", return_value="CHALLENGE (Cloudflare)")
    def test_ignore_on_challenge_fails(self, _probe):
        verdict, reason, _ = gate.evaluate_registry([self.row], [])
        self.assertEqual(verdict, "FAIL")
        self.assertIn("runner blocking", reason)

    def test_missing_row_fails(self):
        verdict, reason, _ = gate.evaluate_registry([], [])
        self.assertEqual(verdict, "FAIL")
        self.assertIn("no registry row", reason)

    @mock.patch.object(gate, "probe_url", return_value="NON (HTTP 404)")
    def test_bad_verdict_fails(self, _probe):
        row = (
            "| `foo` | `foo.example` | MAYBE | evidence | condition |"
        )
        verdict, reason, _ = gate.evaluate_registry([row], [])
        self.assertEqual(verdict, "FAIL")
        self.assertIn("unknown verdict", reason)

    @mock.patch.object(gate, "probe_url", return_value="NON (LiteSpeed)")
    def test_documented_removal_passes(self, _probe):
        added = ["`foo` a été construit le 2026-10-25."]
        verdict, reason, _ = gate.evaluate_registry(added, [self.row])
        self.assertEqual(verdict, "PASS")
        self.assertIn("registry", reason)

    @mock.patch.object(gate, "probe_url", return_value="CHALLENGE (Cloudflare)")
    def test_removal_of_blocked_site_fails(self, _probe):
        added = ["`foo` retiré."]
        verdict, reason, _ = gate.evaluate_registry(added, [self.row])
        self.assertEqual(verdict, "FAIL")
        self.assertIn("still not readable", reason)

    @mock.patch.object(gate, "probe_url", return_value="NON (LiteSpeed)")
    def test_removal_superseded_by_port_passes(self, _probe):
        added = [
            "`foo` a été porté sur `new.example` (voir le cycle).",
            "| `foo` | `new.example` | PORTÉ (#42) | gate live PASS |",
        ]
        verdict, reason, probes = gate.evaluate_registry(added, [self.row])
        self.assertEqual(verdict, "PASS")
        self.assertIn("registry", reason)
        self.assertTrue(any("ported:" in probe for probe in probes or []))

    @mock.patch.object(gate, "probe_url", return_value="CHALLENGE (Cloudflare)")
    def test_removal_superseded_by_unreadable_port_fails(self, _probe):
        added = [
            "`foo` a été porté sur `new.example`.",
            "| `foo` | `new.example` | PORTÉ (#42) | gate live PASS |",
        ]
        verdict, reason, _ = gate.evaluate_registry(added, [self.row])
        self.assertEqual(verdict, "FAIL")
        self.assertIn("ported domain not readable", reason)

    @mock.patch.object(gate, "probe_url", return_value="NON (LiteSpeed)")
    def test_undocumented_removal_fails(self, _probe):
        verdict, reason, _ = gate.evaluate_registry([], [self.row])
        self.assertEqual(verdict, "FAIL")
        self.assertIn("not documented", reason)


class LiveTest(unittest.TestCase):
    def test_ok(self):
        verdict, _ = gate.classify_live({"status": "OK"})
        self.assertEqual(verdict, "PASS")

    def test_blocked_is_hold(self):
        result = {
            "status": "BLOCKED",
            "probe": {"verdict": "BLOCKED", "detail": "challenge"},
        }
        verdict, _ = gate.classify_live(result)
        self.assertEqual(verdict, "HOLD")

    def test_blocked_keeps_stage_reason(self):
        result = {
            "status": "BLOCKED",
            "stageStatus": "PAGES_EMPTY",
            "probe": {"verdict": "BLOCKED", "detail": "HTTP 403"},
        }
        verdict, reason = gate.classify_live(result)
        self.assertEqual(verdict, "HOLD")
        self.assertIn("PAGES_EMPTY", reason)

    def test_empty_but_alive_fails(self):
        result = {
            "status": "EMPTY",
            "probe": {"verdict": "ALIVE", "detail": "HTTP 200"},
        }
        verdict, _ = gate.classify_live(result)
        self.assertEqual(verdict, "FAIL")

    def test_dead_fails(self):
        result = {
            "status": "DEAD",
            "probe": {"verdict": "DEAD", "detail": "HTTP 404"},
        }
        verdict, _ = gate.classify_live(result)
        self.assertEqual(verdict, "FAIL")

    def test_network_unknown_is_hold(self):
        result = {
            "status": "NETWORK",
            "probe": {"verdict": "UNKNOWN", "detail": "timeout"},
        }
        verdict, _ = gate.classify_live(result)
        self.assertEqual(verdict, "HOLD")

    def test_search_empty_fails(self):
        verdict, _ = gate.classify_live({"status": "SEARCH_EMPTY"})
        self.assertEqual(verdict, "FAIL")


class CliTest(unittest.TestCase):
    def test_parse_prs(self):
        self.assertEqual(gate.parse_prs("530, 531,532"), [530, 531, 532])


if __name__ == "__main__":
    unittest.main()
