#!/usr/bin/env python3
"""Deterministic verification gate for keiyoushi PRs.

Reads the PR list (or discovers PRs by issue), checks scope, compiles the
branch, runs targeted live tests, compares the scraper baseUrl with upstream,
and writes a REVIEW_FILE compatible with keiyoushi_merge.py.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from urllib.parse import urlparse

REPO = os.environ.get("GITHUB_REPOSITORY", "KOUSSEMONAUREL/Project-WebMedia")
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__)))))
TS_DIR = os.path.join(ROOT, "scrapers", "webtoons")
TSC = os.path.join(TS_DIR, "node_modules", ".bin", "tsc")
TSX = os.path.join(TS_DIR, "node_modules", ".bin", "tsx")
REGISTRY = "scrapers/webtoons/SOURCES_NON_SCRAPPABLES.md"
DEFAULT_REVIEW_FILE = "/tmp/keiyoushi_review.json"
DEFAULT_HANDOFF = "/tmp/keiyoushi_handoff.json"
DEFAULT_PR_LIST = "/tmp/keiyoushi_prs.json"
APP_UA = os.environ.get(
    "APP_UA",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
)
PROTECTED = (
    "scrapers/webtoons/sync/keiyoushi_gate.py",
    "scrapers/webtoons/sync/test_keiyoushi_gate.py",
    "scrapers/webtoons/tests/gate_scraper.ts",
)

DEFINITION_RE = re.compile(
    r"^scrapers/webtoons/definitions/webtoons/([^/]+)/([^/]+)\.ts$")
ENGINE_RE = re.compile(r"^scrapers/webtoons/engine/[^/]+\.ts$")

SECRET_RE = (
    re.compile(r"\bghp_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\bSUPABASE_SERVICE_ROLE\b"),
    re.compile(r"postgres(?:ql)?://[^ \t]+:[^ \t]+@"),
)

DANGEROUS_RE = (
    re.compile(r"\bchild_process\b"),
    re.compile(r"\bprocess\.env\b"),
    re.compile(r"\beval\s*\("),
    re.compile(r"\bnew\s+Function\b"),
    re.compile(r"from\s+['\"]node:fs['\"]"),
    re.compile(r"from\s+['\"]fs['\"]"),
    re.compile(r"require\(\s*['\"]fs['\"]\s*\)"),
)

CHALLENGE_MARKERS = (
    "/cdn-cgi/challenge-platform/",
    "enable javascript and cookies to continue",
    "window._cf_chl_opt",
    "cf_chl_opt",
    "challenge-form",
    "<title>just a moment...</title>",
)

VERDICTS = ("IGNORE", "UNKNOWN", "BLOCKED", "BUILD", "ADAPT", "REMOVE", "FIX")


class CommandError(RuntimeError):
    pass


def run(args, cwd=ROOT, timeout=120, env=None, check=False):
    try:
        result = subprocess.run(
            args,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
        )
    except subprocess.TimeoutExpired as exc:
        raise CommandError(
            f"timeout after {timeout}s: {' '.join(str(a) for a in args)}"
        ) from exc
    if check and result.returncode != 0:
        raise CommandError(
            f"command failed ({result.returncode}): {' '.join(args)}\n"
            f"{result.stdout}\n{result.stderr}"
        )
    return result


def scrubbed_env():
    env = dict(os.environ)
    for key in (
        "GH_TOKEN",
        "GITHUB_TOKEN",
        "GOOGLE_GENERATIVE_AI_API_KEY",
        "SUPABASE_DATABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
    ):
        env.pop(key, None)
    return env


def load_json(path):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return None


def normalize_base_url(url):
    if not url:
        return ""
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    path = parsed.path.rstrip("/")
    return f"{parsed.scheme}://{host}{path}"


def is_allowed_path(path):
    return bool(
        DEFINITION_RE.match(path)
        or ENGINE_RE.match(path)
        or path == REGISTRY
    )


def added_lines(diff):
    lines = []
    for line in diff.splitlines():
        if line.startswith("+") and not line.startswith("+++"):
            lines.append(line[1:])
    return lines


def removed_lines(diff):
    lines = []
    for line in diff.splitlines():
        if line.startswith("-") and not line.startswith("---"):
            lines.append(line[1:])
    return lines


def scan_added_lines(lines):
    reasons = []
    for line in lines:
        for pattern in SECRET_RE:
            if pattern.search(line):
                reasons.append(f"secret-like value: {pattern.pattern}")
        for pattern in DANGEROUS_RE:
            if pattern.search(line):
                reasons.append(f"forbidden API: {pattern.pattern}")
    return sorted(set(reasons))


def evaluate_scope(files, matched_changes):
    paths = [path for _, path in files]
    reasons = []
    if not paths:
        reasons.append("empty diff")
    bad = [path for path in paths if not is_allowed_path(path)]
    if bad:
        reasons.append("forbidden paths: " + ", ".join(bad))
    registry_paths = [path for path in paths if path == REGISTRY]
    if registry_paths and len(registry_paths) != len(paths):
        reasons.append("registry PR mixes registry and code paths")
    if matched_changes:
        allowed = set()
        for change in matched_changes:
            allowed.update(change.get("paths", []))
        extra = [path for path in paths if path not in allowed]
        if extra:
            reasons.append("paths outside handoff: " + ", ".join(extra))
    kind = "registry" if registry_paths else "code"
    return kind, reasons


def ext_from_path(path):
    match = DEFINITION_RE.match(path)
    if not match:
        return None
    return match.group(1), match.group(2)


def collect_exts(files, matched_changes):
    found = []
    seen = set()
    for _, path in files:
        parsed = ext_from_path(path)
        if parsed and parsed not in seen:
            seen.add(parsed)
            found.append((parsed[0], parsed[1], path))
    if not found and matched_changes:
        for change in matched_changes:
            ext = str(change.get("ext", "")).split("/")[-1]
            for path in change.get("paths", []):
                parsed = ext_from_path(path)
                if parsed and parsed not in seen:
                    seen.add(parsed)
                    found.append((parsed[0], parsed[1], path))
    return found


def parse_upstream_base_url(text):
    match = re.search(r'baseUrl\s*=\s*["\']([^"\']+)["\']', text)
    if match:
        return match.group(1)
    block = re.search(r"baseUrl\s*\{([^}]*)\}", text, re.S)
    if block:
        match = re.search(r'["\'](https?://[^"\']+)["\']', block.group(1))
        if match:
            return match.group(1)
    return None


def fetch_upstream_base_url(lang, ext, sha):
    url = (
        "https://raw.githubusercontent.com/keiyoushi/extensions-source/"
        f"{sha}/src/{lang}/{ext}/build.gradle.kts"
    )
    result = run(
        ["curl", "-fsSL", "--max-time", "15", "-A", APP_UA, url],
        timeout=20,
    )
    if result.returncode != 0:
        return None
    return parse_upstream_base_url(result.stdout)


def probe_url(url):
    if not url:
        return "ERREUR: url vide"
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    with tempfile.TemporaryDirectory() as tmp:
        headers_file = os.path.join(tmp, "headers")
        body_file = os.path.join(tmp, "body")
        try:
            result = run(
                [
                    "curl", "-sS", "-L", "-4", "--max-time", "15",
                    "-A", APP_UA,
                    "-D", headers_file, "-o", body_file,
                    "-w", "%{http_code}", url,
                ],
                timeout=25,
            )
        except CommandError:
            return "TIMEOUT"
        code = (result.stdout or "").strip()
        headers = ""
        body = ""
        try:
            with open(headers_file, encoding="utf-8", errors="replace") as handle:
                headers = handle.read().lower()
        except OSError:
            pass
        try:
            with open(body_file, encoding="utf-8", errors="replace") as handle:
                body = handle.read(50_000).lower()
        except OSError:
            pass
    if result.returncode == 28:
        return "TIMEOUT"
    if result.returncode != 0 and code in ("", "000"):
        return f"ERREUR: curl {result.returncode}"
    if code == "451" or re.search(r"error code:?\s*1026", f"{headers}\n{body}"):
        return "BLOCK IP (451/1026)"
    if "cf-mitigated: challenge" in headers or any(
            marker in body for marker in CHALLENGE_MARKERS):
        return "CHALLENGE (Cloudflare)"
    if "cloudflare" in headers or "cf-ray" in headers:
        if code and not code.startswith(("2", "3")):
            return f"OUI (Cloudflare, HTTP {code})"
        return "OUI (Cloudflare)"
    server = ""
    for line in headers.splitlines():
        if line.startswith("server:"):
            server = line.split(":", 1)[1].strip()
    if code and not code.startswith(("2", "3")):
        return f"NON (HTTP {code}{', ' + server if server else ''})"
    return f"NON ({server or 'accessible'})"


def classify_live(result):
    if not result:
        return "FAIL", "gate_scraper produced no result"
    status = str(result.get("status", "ERROR"))
    stage_status = str(result.get("stageStatus", status))
    probe = result.get("probe")
    if not isinstance(probe, dict):
        probe = {}
    probe_verdict = str(probe.get("verdict", ""))
    probe_detail = str(probe.get("detail", ""))
    base_url = str(result.get("baseUrl", ""))
    if not probe_verdict and base_url and status != "OK":
        probe_text = probe_url(base_url)
        if probe_text.startswith("CHALLENGE") or probe_text.startswith("BLOCK IP"):
            probe_verdict = "BLOCKED"
        elif probe_text.startswith("TIMEOUT") or probe_text.startswith("ERREUR"):
            probe_verdict = "UNKNOWN"
        elif probe_text.startswith("NON (HTTP 404") or probe_text.startswith("NON (HTTP 410"):
            probe_verdict = "DEAD"
        elif probe_text.startswith("OUI") or probe_text.startswith("NON ("):
            probe_verdict = "ALIVE"
        probe_detail = probe_text

    if status == "OK":
        return "PASS", "live OK"
    if status == "BLOCKED":
        return "HOLD", f"live unverified ({stage_status}): {probe_detail or 'blocked'}"
    if status == "DEAD":
        return "FAIL", f"site dead ({stage_status}): {probe_detail or 'dead'}"
    if status == "NETWORK":
        if probe_verdict == "DEAD":
            return "FAIL", f"site dead ({stage_status}): {probe_detail or status}"
        return "HOLD", f"network failure ({stage_status}): {probe_detail or status}"
    if status in ("EMPTY", "UNKNOWN"):
        if probe_verdict in ("BLOCKED", "UNKNOWN"):
            return "HOLD", f"live unverified ({stage_status}): {probe_detail or status}"
        if probe_verdict == "DEAD":
            return "FAIL", f"site dead ({stage_status}): {probe_detail or status}"
        if probe_verdict == "ALIVE":
            return "FAIL", f"site alive but {stage_status.lower()}: {probe_detail or status}"
        return "HOLD", f"live unverified ({stage_status}): {probe_detail or status}"
    if status in ("SEARCH_EMPTY", "CHAPTERS_EMPTY", "PAGES_EMPTY"):
        return "FAIL", f"live parse failure: {status}"
    return "FAIL", f"live error: {result.get('error') or status}"


def parse_registry_rows(lines):
    rows = []
    for line in lines:
        stripped = line.strip()
        if not stripped.startswith("|") or "`" not in stripped:
            continue
        cells = [cell.strip() for cell in stripped.strip("|").split("|")]
        if len(cells) >= 5:
            rows.append(cells)
    return rows


def evaluate_registry(added, removed):
    added_rows = parse_registry_rows(added)
    removed_rows = parse_registry_rows(removed)
    if not added_rows and not removed_rows:
        return "FAIL", "no registry row found in diff", None
    reasons = []
    probes = []
    for cells in added_rows:
        ext = cells[0].strip("` ")
        domain = cells[1].strip("` ")
        verdict = cells[2].strip("` ").upper()
        evidence = cells[3].strip()
        revival = cells[4].strip()
        if verdict not in VERDICTS and "RETIRE" not in verdict:
            reasons.append(f"{ext}: unknown verdict {verdict!r}")
        if not evidence or evidence in ("-", "n/a"):
            reasons.append(f"{ext}: missing evidence")
        if not revival:
            reasons.append(f"{ext}: missing revival condition")
        elif revival.lower() in ("n/a", "-") and "RETIRE" not in verdict:
            reasons.append(f"{ext}: revival condition is {revival!r}")
        host = domain.split("+")[0].strip().strip("` ")
        if host:
            probe = probe_url(host)
            probes.append(f"{ext}: {probe}")
            if verdict == "IGNORE" and (
                    probe.startswith("CHALLENGE") or probe.startswith("BLOCK IP")):
                reasons.append(f"{ext}: IGNORE rests on runner blocking ({probe})")
            if verdict in ("BLOCKED", "UNKNOWN") and probe.startswith("OUI"):
                reasons.append(f"{ext}: {verdict} but site responds ({probe})")
            if probe.startswith("TIMEOUT") or probe.startswith("ERREUR"):
                reasons.append(f"{ext}: probe inconclusive ({probe})")
    for cells in removed_rows:
        ext = cells[0].strip("` ")
        domain = cells[1].strip("` ")
        host = domain.split("+")[0].strip().strip("` ")
        mentioned = any(
            ext in line or host in line
            for line in added
            if line.strip() and not line.strip().startswith("|")
        )
        if not mentioned:
            reasons.append(f"{ext}: removal not documented in added prose")
        if host:
            probe = probe_url(host)
            probes.append(f"{ext}: removed: {probe}")
            if probe.startswith(("CHALLENGE", "BLOCK IP", "TIMEOUT", "ERREUR")):
                reasons.append(f"{ext}: removed but site still not readable ({probe})")
            if probe.startswith(("NON (HTTP 404", "NON (HTTP 410")):
                reasons.append(f"{ext}: removed but site is dead ({probe})")
    if reasons:
        return "FAIL", "; ".join(reasons), probes
    return "PASS", "registry structure and probe ok", probes


def git_clean():
    args = ["git", "clean", "-fd"]
    for path in PROTECTED:
        args.extend(["-e", path])
    run(args, timeout=60, check=True)


def prepare_repo():
    run(["git", "fetch", "origin", "main", "--quiet"], timeout=120, check=True)
    run(["git", "checkout", "--detach", "origin/main", "--force"],
        timeout=120, check=True)
    git_clean()


def cleanup_repo():
    run(["git", "checkout", "--detach", "origin/main", "--force"],
        timeout=120, check=True)
    run(["git", "reset", "--hard", "origin/main"], timeout=120, check=True)
    git_clean()


def pr_view(number):
    result = run(
        ["gh", "pr", "view", str(number), "--repo", REPO, "--json",
         "number,title,url,state,isDraft,baseRefName,headRefName,headRefOid,"
         "mergeable,headRepositoryOwner"],
        timeout=60,
    )
    if result.returncode != 0:
        return None, result.stderr.strip() or "gh pr view failed"
    try:
        return json.loads(result.stdout), ""
    except ValueError as exc:
        return None, f"invalid gh pr view JSON: {exc}"


def pr_files(number):
    result = run(
        ["gh", "api", f"repos/{REPO}/pulls/{number}/files", "--paginate",
         "--jq", '.[] | "\\(.status)\\t\\(.filename)"'],
        timeout=60,
    )
    if result.returncode != 0:
        return None, result.stderr.strip() or "gh api files failed"
    files = []
    for line in result.stdout.splitlines():
        if "\t" not in line:
            continue
        status, path = line.split("\t", 1)
        files.append((status.strip(), path.strip()))
    return files, ""


def pr_diff(number):
    result = run(
        ["gh", "pr", "diff", str(number), "--repo", REPO],
        timeout=90,
    )
    if result.returncode != 0:
        return None, result.stderr.strip() or "gh pr diff failed"
    return result.stdout, ""


def discover_prs(issue):
    result = run(
        ["gh", "pr", "list", "--repo", REPO, "--state", "open",
         "--limit", "100", "--json",
         "number,title,url,headRefName,headRefOid,baseRefName,state"],
        timeout=60,
    )
    if result.returncode != 0:
        raise CommandError(result.stderr.strip() or "gh pr list failed")
    prefix = f"fix/keiyoushi-{issue}-" if issue else "fix/keiyoushi-"
    prs = []
    for item in json.loads(result.stdout):
        if str(item.get("headRefName", "")).startswith(prefix):
            prs.append(item)
    return sorted(prs, key=lambda item: item["number"])


def parse_prs(value):
    return [int(part.strip()) for part in value.split(",") if part.strip()]


def find_matched_changes(paths, handoff):
    if not isinstance(handoff, dict):
        return []
    changes = handoff.get("changes")
    if not isinstance(changes, list):
        return []
    path_set = set(paths)
    matched = []
    for change in changes:
        if not isinstance(change, dict):
            continue
        change_paths = change.get("paths")
        if not isinstance(change_paths, list):
            continue
        if path_set.intersection(change_paths):
            matched.append(change)
    return matched


def count_of(result, key):
    section = result.get(key)
    if isinstance(section, dict):
        value = section.get("count")
        if isinstance(value, int):
            return value
    return None


def run_gate_scraper(path):
    result = run(
        [TSX, "tests/gate_scraper.ts", path],
        cwd=TS_DIR,
        timeout=150,
        env=scrubbed_env(),
    )
    output = (result.stdout or "") + "\n" + (result.stderr or "")
    for line in reversed(output.splitlines()):
        if line.startswith("GATE_JSON:"):
            try:
                data = json.loads(line[len("GATE_JSON:"):])
            except ValueError as exc:
                return {"status": "ERROR", "error": f"invalid GATE_JSON: {exc}"}
            if isinstance(data, dict):
                return data
            return {"status": "ERROR", "error": "GATE_JSON is not an object"}
    return {
        "status": "ERROR",
        "error": f"no GATE_JSON in output: {output[-800:]}",
    }


def process_pr(info, handoff, upstream_sha, live):
    number = info["number"]
    entry = {
        "number": number,
        "verdict": "FAIL",
        "head_sha": info.get("headRefOid", ""),
        "reason": "",
        "checks": {},
    }
    reasons = []
    holds = []
    files, error = pr_files(number)
    if error or files is None:
        entry["reason"] = error or "no files returned"
        return entry
    paths = [path for _, path in files]
    matched = find_matched_changes(paths, handoff)
    kind, scope_reasons = evaluate_scope(files, matched)
    reasons.extend(scope_reasons)

    diff, error = pr_diff(number)
    if error:
        reasons.append(error)
        diff = ""
    security = scan_added_lines(added_lines(diff))
    reasons.extend(security)

    entry["checks"]["paths"] = paths
    entry["checks"]["kind"] = kind
    entry["checks"]["scope_ok"] = not scope_reasons
    entry["checks"]["security_ok"] = not security

    if reasons:
        entry["reason"] = "; ".join(reasons)
        return entry

    try:
        prepare_repo()
        checkout = run(
            ["gh", "pr", "checkout", str(number), "--repo", REPO,
             "--detach", "--force"],
            timeout=120,
        )
        if checkout.returncode != 0:
            reasons.append(checkout.stderr.strip() or "gh pr checkout failed")
        else:
            head = run(["git", "rev-parse", "HEAD"], timeout=30).stdout.strip()
            entry["checks"]["head_ok"] = head == info.get("headRefOid")
            if head != info.get("headRefOid"):
                reasons.append(
                    f"head changed: tested {head[:12]}, PR {info.get('headRefOid', '')[:12]}"
                )

        if not reasons and kind == "registry":
            verdict, reason, probes = evaluate_registry(
                added_lines(diff), removed_lines(diff))
            entry["checks"]["registry_probes"] = probes
            if verdict == "FAIL":
                reasons.append(reason)
            else:
                holds.append("registry PR requires manual review")
                entry["checks"]["registry_ok"] = True

        if not reasons and kind == "code":
            typecheck = run(
                [TSC, "--noEmit"],
                cwd=TS_DIR,
                timeout=180,
                env=scrubbed_env(),
            )
            entry["checks"]["tsc_ok"] = typecheck.returncode == 0
            if typecheck.returncode != 0:
                reasons.append(
                    "tsc failed: "
                    + ((typecheck.stdout or "") + (typecheck.stderr or ""))[-600:].strip()
                )

        exts = collect_exts(files, matched)
        entry["checks"]["exts"] = [f"{lang}/{ext}" for lang, ext, _ in exts]
        if not reasons and kind == "code" and not exts:
            holds.append("no scraper ext found in diff")
        if not reasons and kind == "code" and not live:
            entry["checks"]["live_skipped"] = True
            holds.append("live checks skipped")

        if not reasons and kind == "code" and live:
            for lang, ext, path in exts:
                result = run_gate_scraper(path)
                entry["checks"][f"live_{lang}_{ext}"] = {
                    "status": result.get("status"),
                    "popular": count_of(result, "popular"),
                    "search": count_of(result, "search"),
                    "chapters": count_of(result, "chapters"),
                    "pages": count_of(result, "pages"),
                    "probe": result.get("probe"),
                }
                verdict, reason = classify_live(result)
                if verdict == "FAIL":
                    reasons.append(f"{lang}/{ext}: {reason}")
                elif verdict == "HOLD":
                    holds.append(f"{lang}/{ext}: {reason}")
                expected = fetch_upstream_base_url(lang, ext, upstream_sha)
                actual = result.get("baseUrl", "")
                entry["checks"][f"base_url_{lang}_{ext}"] = {
                    "upstream": expected,
                    "actual": actual,
                }
                if expected is None:
                    holds.append(f"{lang}/{ext}: upstream baseUrl unavailable")
                elif normalize_base_url(expected) != normalize_base_url(actual):
                    reasons.append(
                        f"{lang}/{ext}: baseUrl mismatch upstream={expected} ts={actual}"
                    )
    except CommandError as exc:
        reasons.append(str(exc))
    finally:
        try:
            cleanup_repo()
        except CommandError as exc:
            reasons.append(f"cleanup failed: {exc}")

    if reasons:
        entry["verdict"] = "FAIL"
        entry["reason"] = "; ".join(reasons)
    elif holds:
        entry["verdict"] = "HOLD"
        entry["reason"] = "; ".join(holds)
    else:
        entry["verdict"] = "PASS"
        parts = ["scope ok", "tsc ok", "live ok", "baseUrl ok"]
        entry["reason"] = "; ".join(parts)
    return entry


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--issue", type=int)
    parser.add_argument("--prs")
    parser.add_argument("--pr-list", default=DEFAULT_PR_LIST)
    parser.add_argument("--handoff", default=DEFAULT_HANDOFF)
    parser.add_argument("--output", default=DEFAULT_REVIEW_FILE)
    parser.add_argument("--upstream-sha", default=os.environ.get(
        "UPSTREAM_SHA", os.environ.get("HEAD_SHA", "main")))
    parser.add_argument("--no-live", action="store_true")
    args = parser.parse_args()

    if args.prs:
        numbers = parse_prs(args.prs)
        prs = []
        for number in numbers:
            info, error = pr_view(number)
            if error:
                print(f"#{number}: {error}", file=sys.stderr)
                continue
            prs.append(info)
    elif args.issue:
        prs = discover_prs(args.issue)
    else:
        data = load_json(args.pr_list) or []
        prs = []
        for item in data:
            info, error = pr_view(item["number"])
            if error:
                print(f"#{item['number']}: {error}", file=sys.stderr)
                continue
            prs.append(info)

    handoff = load_json(args.handoff)
    if not prs:
        print("No PRs to check.")
        return 0

    entries = []
    for index, info in enumerate(prs, start=1):
        number = info["number"]
        print(f"[{index}/{len(prs)}] #{number} {info.get('title', '')}")
        try:
            entry = process_pr(
                info, handoff, args.upstream_sha, not args.no_live)
        except Exception as exc:
            entry = {
                "number": number,
                "verdict": "FAIL",
                "head_sha": info.get("headRefOid", ""),
                "reason": f"gate crash: {exc}",
                "checks": {},
            }
        entries.append(entry)
        print(f"  -> {entry['verdict']}: {entry['reason']}")

    output_dir = os.path.dirname(args.output)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump({"prs": entries, "gate_version": 1}, handle, indent=2)
    counts = {}
    for entry in entries:
        counts[entry["verdict"]] = counts.get(entry["verdict"], 0) + 1
    print(json.dumps({"ok": True, "counts": counts, "output": args.output}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
