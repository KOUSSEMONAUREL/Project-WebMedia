#!/usr/bin/env python3
"""Revue IA independante des PRs keiyoushi.

Le gate deterministe reste la premiere couche. Ses FAIL sont definitifs:
le runner les synthetise directement et ne les envoie jamais au modele.
Seules les PRs PASS/HOLD sont transmises a l'IA, avec leur diff deja
precharge, dans un bundle compact. Le modele ecrit des verdicts partiels;
le runner les fusionne avec les FAIL synthetises et valide la revue complete.

Le bundle est compacte (budget par diff, budget total, mode compact
optionnel) et le budget de chaque modele est calcule a partir de la charge
reelle. Un modele qui progresse encore peut obtenir une prolongation bornee;
le budget global reste plafonne pour laisser la place aux replis.

Le runner essaie les modeles dans le meme ordre que l'agent d'analyse:
PRIMARY_MODEL, FALLBACK_MODEL, GEMINI_MODEL, FALLBACK3_MODEL,
FALLBACK4_MODEL. Un modele n'est considere reussi que si le fichier partiel
existe et passe la validation stricte de `keiyoushi_review_policy`.

Si tous les modeles echouent, le runner ecrit une revue de repli valide qui
bloque les PASS/HOLD en HOLD. Ainsi, une panne de la revue IA ne peut jamais
provoquer le merge d'un PASS non relu.
"""

import json
import os
import shutil
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import keiyoushi_review_policy as policy  # noqa: E402

REPO = os.environ.get(
    "GITHUB_REPOSITORY", "KOUSSEMONAUREL/Project-WebMedia"
)
REPO_ROOT = os.environ.get(
    "GITHUB_WORKSPACE",
    os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.dirname(os.path.abspath(__file__))))),
)
PROMPT_FILE = os.environ.get(
    "REVIEW_PROMPT_FILE",
    os.path.join(REPO_ROOT, ".github/prompts/keiyoushi-review.md"),
)
PR_LIST_FILE = os.environ.get("PR_LIST_FILE", "/tmp/keiyoushi_prs.json")
GATE_REVIEW_FILE = os.environ.get("REVIEW_FILE", "/tmp/keiyoushi_review.json")
HANDOFF_FILE = os.environ.get("HANDOFF_FILE", "/tmp/keiyoushi_handoff.json")
AI_REVIEW_FILE = os.environ.get(
    "AI_REVIEW_FILE", "/tmp/keiyoushi_ai_review.json"
)
AI_REVIEW_PARTIAL_FILE = os.environ.get(
    "AI_REVIEW_PARTIAL_FILE", "/tmp/keiyoushi_ai_review_partial.json"
)
AI_REVIEW_BUNDLE_FILE = os.environ.get(
    "AI_REVIEW_BUNDLE_FILE", "/tmp/keiyoushi_review_bundle.json"
)
AI_REVIEW_STATUS_FILE = os.environ.get(
    "AI_REVIEW_STATUS_FILE", "/tmp/keiyoushi_ai_review_status.json"
)
AI_REVIEW_ADVISORY = os.environ.get(
    "AI_REVIEW_ADVISORY", ""
).strip().lower() in ("1", "true", "yes", "on")
COMPACT = os.environ.get(
    "AI_REVIEW_COMPACT", ""
).strip().lower() in ("1", "true", "yes", "on")
LOG_DIR = os.environ.get("AI_REVIEW_LOG_DIR", "/tmp/keiyoushi-ai-review-logs")
MODEL_TIMEOUT_MIN_S = int(
    os.environ.get("AI_REVIEW_MODEL_TIMEOUT_MIN_S", "180")
)
MODEL_TIMEOUT_MAX_S = int(
    os.environ.get(
        "AI_REVIEW_MODEL_TIMEOUT_MAX_S",
        os.environ.get("AI_REVIEW_MODEL_TIMEOUT_S", "1200"),
    )
)
TOTAL_DEADLINE_S = int(os.environ.get("AI_REVIEW_TOTAL_DEADLINE_S", "2400"))
WALL_BUDGET_S = int(os.environ.get("AI_REVIEW_WALL_BUDGET_S", "2600"))
MODEL_GRACE_S = int(os.environ.get("AI_REVIEW_MODEL_GRACE_S", "180"))
MODEL_GRACE_IDLE_S = int(
    os.environ.get("AI_REVIEW_MODEL_GRACE_IDLE_S", "60")
)
SECONDS_PER_DIFF_CHAR = float(
    os.environ.get("AI_REVIEW_SECONDS_PER_DIFF_CHAR", "0.008")
)
SECONDS_PER_PR = int(os.environ.get("AI_REVIEW_SECONDS_PER_PR", "25"))
BASE_SECONDS = int(os.environ.get("AI_REVIEW_BASE_SECONDS", "90"))
DIFF_TIMEOUT_S = int(os.environ.get("AI_REVIEW_DIFF_TIMEOUT_S", "60"))
MAX_DIFF_CHARS = int(
    os.environ.get(
        "AI_REVIEW_MAX_DIFF_CHARS", "12000" if COMPACT else "24000"
    )
)
MAX_TOTAL_DIFF_CHARS = int(
    os.environ.get(
        "AI_REVIEW_MAX_TOTAL_DIFF_CHARS", "60000" if COMPACT else "120000"
    )
)
MIN_DIFF_CHARS = int(os.environ.get("AI_REVIEW_MIN_DIFF_CHARS", "2000"))
MAX_HANDOFF_CHARS = int(
    os.environ.get(
        "AI_REVIEW_MAX_HANDOFF_CHARS", "8000" if COMPACT else "12000"
    )
)
COMPACT_REASON_MAX = int(
    os.environ.get("AI_REVIEW_COMPACT_REASON_MAX", "700")
)
RUN_CONTEXT = {}
RUN_STARTED = time.monotonic()
MODEL_SLOTS = (
    "PRIMARY_MODEL",
    "FALLBACK_MODEL",
    "GEMINI_MODEL",
    "FALLBACK3_MODEL",
    "FALLBACK4_MODEL",
)
UNSAFE_ENV_KEYS = (
    "GITHUB_ENV",
    "GITHUB_PATH",
    "GITHUB_OUTPUT",
    "GITHUB_STATE",
    "GITHUB_STEP_SUMMARY",
    "BASH_ENV",
    "ENV",
    "PYTHONPATH",
    "PYTHONSTARTUP",
    "ACTIONS_RUNTIME_TOKEN",
    "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
    "ACTIONS_ID_TOKEN_REQUEST_URL",
    "ACTIONS_CACHE_URL",
    "ACTIONS_RESULTS_URL",
)


def model_chain():
    override = os.environ.get("REVIEW_MODELS", "")
    raw = override.split(",") if override.strip() else [
        os.environ.get(slot, "") for slot in MODEL_SLOTS
    ]
    models = []
    seen = set()
    for item in raw:
        model = item.strip()
        if model and model not in seen:
            seen.add(model)
            models.append(model)
    return models


def advisory_exit_code(code):
    return 0 if AI_REVIEW_ADVISORY else code


def write_status(status, reason, attempts=None, reviewer_model=""):
    payload = {
        "status": status,
        "reason": reason,
        "attempts": attempts or [],
        "reviewer_model": reviewer_model,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if RUN_CONTEXT:
        payload["run"] = dict(RUN_CONTEXT)
    try:
        directory = os.path.dirname(AI_REVIEW_STATUS_FILE)
        if directory:
            os.makedirs(directory, exist_ok=True)
        temporary = AI_REVIEW_STATUS_FILE + ".tmp"
        with open(temporary, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
        os.replace(temporary, AI_REVIEW_STATUS_FILE)
    except OSError as exc:
        print(f"AI_REVIEW_STATUS_WRITE_FAILED: {exc}", flush=True)
    return payload


def unavailable(reason, attempts=None):
    write_status("unavailable", reason, attempts)
    print(f"AI_REVIEW_UNAVAILABLE: {reason}", flush=True)
    return advisory_exit_code(1)


def opencode_bin():
    found = shutil.which("opencode")
    if found:
        return found
    local = os.path.expanduser("~/.opencode/bin/opencode")
    return local if os.path.exists(local) else ""


def load_json(path):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return None


def load_flexible_json(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            text = handle.read()
    except OSError:
        return None
    stripped = text.strip()
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        stripped = "\n".join(lines).strip()
    try:
        return json.loads(stripped)
    except ValueError:
        return None


def write_json_atomic(path, data):
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    temporary = path + ".tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2)
    os.replace(temporary, path)


def pr_numbers():
    data = load_json(PR_LIST_FILE)
    if not isinstance(data, list):
        return []
    numbers = []
    for item in data:
        if not isinstance(item, dict):
            continue
        number = item.get("number")
        if type(number) is int and number > 0:
            numbers.append(number)
    return numbers


def pr_metadata():
    data = load_json(PR_LIST_FILE)
    metadata = {}
    if not isinstance(data, list):
        return metadata
    for item in data:
        if not isinstance(item, dict):
            continue
        number = item.get("number")
        if type(number) is not int or number <= 0:
            continue
        metadata[number] = {
            "title": str(item.get("title") or ""),
            "url": str(item.get("url") or ""),
        }
    return metadata


def split_gate_verdicts(numbers, gate_map):
    """Separe les FAIL definitifs des PRs a envoyer au modele."""
    failed = {}
    reviewable = []
    unknown = []
    for number in numbers:
        entry = gate_map.get(number)
        if not isinstance(entry, dict):
            unknown.append(number)
            continue
        verdict = entry.get("verdict")
        if verdict == "FAIL":
            failed[number] = synthesize_fail(entry)
        elif verdict in ("PASS", "HOLD"):
            reviewable.append(number)
        else:
            unknown.append(number)
    return failed, reviewable, unknown


def synthesize_fail(gate_entry):
    return {
        "number": gate_entry.get("number"),
        "verdict": "FAIL",
        "gate_verdict": "FAIL",
        "head_sha": gate_entry.get("head_sha", ""),
        "reason": (
            "The deterministic gate verdict is FAIL and is final; "
            "independent AI review is not applicable."
        ),
        "live_verified": False,
        "live_evidence": "",
        "registry_ok": False,
    }


def synthesize_hold(gate_entry, detail):
    reason = f"Independent AI review unavailable: {detail}"
    return {
        "number": gate_entry.get("number"),
        "verdict": "HOLD",
        "gate_verdict": gate_entry.get("verdict"),
        "head_sha": gate_entry.get("head_sha", ""),
        "reason": reason[:policy.MAX_REASON],
        "live_verified": False,
        "live_evidence": "",
        "registry_ok": False,
    }


def merge_review_entries(synthesized, partial):
    merged = dict(synthesized)
    if isinstance(partial, dict) and isinstance(partial.get("prs"), list):
        for entry in partial["prs"]:
            if isinstance(entry, dict):
                merged[entry.get("number")] = entry
    return [merged[number] for number in sorted(merged)]


def extract_valid_entries(data, gate_map, numbers):
    """Conserve les verdicts valides d'un fichier partiel incomplet."""
    accepted = {}
    if not isinstance(data, dict):
        return accepted
    if data.get("review_version") != policy.AI_REVIEW_VERSION:
        return accepted
    raw = data.get("prs")
    if not isinstance(raw, list):
        return accepted
    expected = set(numbers)
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        number = entry.get("number")
        if type(number) is not int or number <= 0:
            continue
        if number not in expected or number in accepted:
            continue
        gate_entry = gate_map.get(number)
        if not isinstance(gate_entry, dict):
            continue
        if policy.validate_ai_entry(entry, gate_entry, number):
            continue
        accepted[number] = entry
    return accepted


def trim_diff(text, limit):
    marker = "\n\n[TRUNCATED BY REVIEW RUNNER: diff too large]\n"
    if len(text) <= limit:
        return text, False
    if limit <= len(marker):
        return text[:limit], True
    keep = max(0, limit - len(marker))
    return text[:keep] + marker, True


def workload_stats(bundle):
    """Mesure la charge reelle du bundle apres troncature."""
    items = bundle.get("reviewable_prs") if isinstance(bundle, dict) else []
    items = items if isinstance(items, list) else []
    diff_chars = sum(
        len(item.get("diff") or "")
        for item in items
        if isinstance(item, dict)
    )
    handoff = bundle.get("handoff") if isinstance(bundle, dict) else {}
    handoff = handoff if isinstance(handoff, dict) else {}
    handoff_chars = len(str(handoff.get("summary_md") or ""))
    return {
        "pr_count": len(items),
        "diff_chars": diff_chars,
        "handoff_chars": handoff_chars,
        "total_chars": diff_chars + handoff_chars,
    }


def estimate_model_timeout(stats):
    """Convertit la charge du bundle en budget par modele."""
    estimate = (
        BASE_SECONDS
        + int(stats.get("total_chars", 0) * SECONDS_PER_DIFF_CHAR)
        + int(stats.get("pr_count", 0)) * SECONDS_PER_PR
    )
    low = min(MODEL_TIMEOUT_MIN_S, MODEL_TIMEOUT_MAX_S)
    high = max(MODEL_TIMEOUT_MIN_S, MODEL_TIMEOUT_MAX_S)
    return max(low, min(high, estimate))


def estimate_total_deadline(model_count, per_model_timeout):
    """Donne une chance a plusieurs modeles sans depasser la borne globale."""
    attempts = min(max(1, model_count), 3)
    needed = per_model_timeout * attempts + 120
    return max(per_model_timeout, min(TOTAL_DEADLINE_S, needed))


def remaining_wall_budget():
    elapsed = time.monotonic() - RUN_STARTED
    return max(0, WALL_BUDGET_S - int(elapsed))


def fetch_pr_diff(number, budget):
    """Precharge le diff d'une PR, avec une seule tentative de retry."""
    if budget <= 0:
        return None, False, "budget de diff epuise"
    limit = min(MAX_DIFF_CHARS, budget)
    last_error = ""
    for _ in range(2):
        try:
            result = subprocess.run(
                ["gh", "pr", "diff", str(number), "--repo", REPO],
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
                timeout=DIFF_TIMEOUT_S,
                env=child_env(""),
            )
        except subprocess.TimeoutExpired:
            last_error = f"gh pr diff timeout ({DIFF_TIMEOUT_S}s)"
            continue
        except OSError as exc:
            last_error = f"gh pr diff lancement impossible: {exc}"
            break
        if result.returncode == 0:
            diff = result.stdout
            if not diff.strip():
                last_error = "diff vide"
                continue
            trimmed, truncated = trim_diff(diff, limit)
            return trimmed, truncated, ""
        last_error = (
            (result.stderr or result.stdout).strip()
            or f"gh pr diff rc={result.returncode}"
        )[:500]
    return None, False, last_error or "gh pr diff a echoue"


def build_review_bundle(reviewable, gate_map, metadata, handoff):
    """Construit le bundle compact et les HOLD dus aux diffs indisponibles."""
    items = []
    diff_holds = {}
    used = 0
    per_pr_budget = max(
        MIN_DIFF_CHARS,
        MAX_TOTAL_DIFF_CHARS // max(1, len(reviewable)),
    )
    for number in reviewable:
        remaining = MAX_TOTAL_DIFF_CHARS - used
        budget = min(per_pr_budget, remaining)
        diff, truncated, error = fetch_pr_diff(number, budget)
        if error or diff is None:
            diff_holds[number] = synthesize_hold(
                gate_map[number], f"diff indisponible: {error or 'inconnu'}"
            )
            continue
        used += len(diff)
        info = metadata.get(number, {})
        items.append({
            "number": number,
            "title": info.get("title", ""),
            "url": info.get("url", ""),
            "gate": gate_map[number],
            "diff": diff,
            "diff_truncated": truncated,
        })

    summary = ""
    close = False
    if isinstance(handoff, dict):
        summary = str(handoff.get("summary_md") or "")
        close = handoff.get("close") is True
    summary_truncated = len(summary) > MAX_HANDOFF_CHARS
    bundle = {
        "bundle_version": 1,
        "repo": REPO,
        "issue_number": os.environ.get("ISSUE_NUMBER", ""),
        "upstream_sha": os.environ.get("UPSTREAM_SHA", ""),
        "handoff": {
            "close": close,
            "summary_md": summary[:MAX_HANDOFF_CHARS],
            "summary_truncated": summary_truncated,
        },
        "reviewable_prs": items,
    }
    return bundle, diff_holds


def build_command(opencode, model, budget_s=0):
    command = [opencode, "run", "--model", model]
    if model.startswith("google/"):
        command.append("--auto")
    else:
        command.extend(["--variant", "max", "--thinking", "--auto"])
    instruction = (
        f"Review only the PASS/HOLD PRs in {AI_REVIEW_BUNDLE_FILE}. "
        f"Write the partial verdict JSON to {AI_REVIEW_PARTIAL_FILE}. "
        "Gate FAILs are already synthesized and must not be reviewed or "
        "rewritten. Follow the reviewer prompt exactly. Do not modify any "
        "repository file, do not commit, push, merge, comment, or close "
        "anything. Do not run commands or network probes; use only the "
        "bundle. Keep every reason compact: two sentences, concrete "
        "evidence, no diff restatement."
    )
    if budget_s > 0:
        instruction += (
            f" You have about {int(budget_s)} seconds of review time; "
            "write the partial JSON before the budget runs out."
        )
    command.extend(["--file", PROMPT_FILE, "--", instruction])
    return command


def child_env(model):
    env = os.environ.copy()
    for key in UNSAFE_ENV_KEYS:
        env.pop(key, None)
    if not model.startswith("google/"):
        env.pop("GOOGLE_GENERATIVE_AI_API_KEY", None)
    return env


def terminate_group(pid, sig=signal.SIGTERM):
    try:
        os.killpg(pid, sig)
    except (ProcessLookupError, PermissionError):
        pass


def stop_process(process):
    terminate_group(process.pid)
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        terminate_group(process.pid, signal.SIGKILL)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass


def log_size(path):
    try:
        return os.path.getsize(path)
    except OSError:
        return 0


def run_model(opencode, model, timeout, grace=0):
    """Execute un modele avec une prolongation bornee s'il progresse encore."""
    os.makedirs(LOG_DIR, exist_ok=True)
    safe_model = "".join(
        char if char.isalnum() or char in "._-" else "_" for char in model
    )
    log_path = os.path.join(LOG_DIR, f"{safe_model}.log")
    if os.path.exists(AI_REVIEW_PARTIAL_FILE):
        os.remove(AI_REVIEW_PARTIAL_FILE)

    command = build_command(opencode, model, timeout)
    started = time.monotonic()
    soft_deadline = started + max(1, timeout)
    hard_deadline = soft_deadline + max(0, grace)
    print(
        f"AI_REVIEW_MODEL: {model} (timeout {timeout}s, "
        f"grace {max(0, grace)}s)",
        flush=True,
    )
    with open(log_path, "w", encoding="utf-8", errors="replace") as log:
        process = subprocess.Popen(
            command,
            cwd=REPO_ROOT,
            stdout=log,
            stderr=subprocess.STDOUT,
            env=child_env(model),
            start_new_session=True,
        )
        last_size = 0
        last_growth = started
        returncode = None
        while returncode is None:
            try:
                returncode = process.wait(timeout=5)
                break
            except subprocess.TimeoutExpired:
                pass
            now = time.monotonic()
            size = log_size(log_path)
            if size > last_size:
                last_size = size
                last_growth = now
            if now < soft_deadline:
                continue
            stalled = (
                last_size > 0
                and now - last_growth >= max(1, MODEL_GRACE_IDLE_S)
            )
            if now >= hard_deadline or stalled:
                stop_process(process)
                returncode = 124
        terminate_group(process.pid)
    elapsed = time.monotonic() - started
    print(
        f"AI_REVIEW_MODEL_DONE: {model} rc={returncode} "
        f"elapsed={elapsed:.0f}s",
        flush=True,
    )
    return returncode, log_path


def tail(path, limit=4000):
    try:
        with open(path, "rb") as handle:
            handle.seek(0, os.SEEK_END)
            size = handle.tell()
            handle.seek(max(0, size - 16384))
            text = handle.read().decode("utf-8", "replace")
    except OSError:
        return ""
    return " ".join(text.split())[-limit:]


def normalize_review(data):
    if not isinstance(data, dict) or not isinstance(data.get("prs"), list):
        return data
    for entry in data["prs"]:
        if not isinstance(entry, dict):
            continue
        reason = entry.get("reason")
        limit = COMPACT_REASON_MAX if COMPACT else policy.MAX_REASON
        if isinstance(reason, str) and len(reason) > limit:
            entry["reason"] = reason[:limit]
    return data


def finalize_review(
    entries, gate, numbers, reviewer_model, reason, status="ok", attempts=None
):
    data = {
        "review_version": 1,
        "reviewer_model": reviewer_model,
        "reviewed_at": datetime.now(timezone.utc).isoformat(),
        "prs": [entries[number] for number in sorted(entries)],
    }
    errors = policy.validate_ai_review(data, gate, numbers)
    if errors:
        return unavailable(
            "verdicts internes invalides: " + "; ".join(errors)
        )
    try:
        write_json_atomic(AI_REVIEW_FILE, data)
    except OSError as exc:
        return unavailable(f"ecriture de la revue impossible: {exc}")
    write_status(
        status, reason, attempts=attempts, reviewer_model=reviewer_model
    )
    label = "OK" if status == "ok" else status.upper()
    print(f"AI_REVIEW_{label}: {reviewer_model}: {reason}", flush=True)
    return 0 if status == "ok" else advisory_exit_code(1)


def finalize_fallback(reason, synthesized, reviewable, gate, numbers, attempts):
    """Ecrit une revue valide qui HOLD les PRs non relues par le modele."""
    gate_map = policy.gate_entries(gate)
    entries = dict(synthesized)
    for number in reviewable:
        if number in entries:
            continue
        entry = gate_map.get(number)
        if isinstance(entry, dict):
            entries[number] = synthesize_hold(entry, reason)
    data = {
        "review_version": 1,
        "reviewer_model": "deterministic-fallback",
        "reviewed_at": datetime.now(timezone.utc).isoformat(),
        "prs": [entries[number] for number in sorted(entries)],
    }
    errors = policy.validate_ai_review(data, gate, numbers)
    if errors:
        return unavailable(
            reason + "; repli invalide: " + "; ".join(errors), attempts
        )
    try:
        write_json_atomic(AI_REVIEW_FILE, data)
    except OSError as exc:
        return unavailable(f"{reason}; ecriture du repli impossible: {exc}",
                           attempts)
    write_status(
        "unavailable", reason, attempts,
        reviewer_model="deterministic-fallback",
    )
    print(
        f"AI_REVIEW_FALLBACK: {reason}; PASS/HOLD non relus bloques en HOLD",
        flush=True,
    )
    return advisory_exit_code(1)


def main():
    global RUN_STARTED
    RUN_STARTED = time.monotonic()
    RUN_CONTEXT.clear()
    write_status("running", "revue IA en cours")
    for path in (AI_REVIEW_FILE, AI_REVIEW_PARTIAL_FILE):
        if os.path.exists(path):
            try:
                os.remove(path)
            except OSError as exc:
                return unavailable(f"suppression impossible: {exc}")
    numbers = pr_numbers()
    if not numbers:
        write_status("skipped", "aucune PR a reviewer")
        print("AI_REVIEW_SKIPPED: aucune PR a reviewer")
        return 0
    if not os.path.exists(PROMPT_FILE):
        return unavailable(f"prompt absent: {PROMPT_FILE}")
    if not os.path.exists(GATE_REVIEW_FILE):
        return unavailable(f"gate absent: {GATE_REVIEW_FILE}")

    gate = load_json(GATE_REVIEW_FILE)
    gate_map = policy.gate_entries(gate)
    if not isinstance(gate, dict) or not gate_map:
        return unavailable("gate illisible ou vide")
    missing_gate = [n for n in numbers if n not in gate_map]
    if missing_gate:
        return unavailable(
            "PRs sans verdict gate: "
            + ", ".join(f"#{n}" for n in missing_gate)
        )

    failed, reviewable, unknown = split_gate_verdicts(numbers, gate_map)
    if unknown:
        return unavailable(
            "PRs avec verdict gate inconnu: "
            + ", ".join(f"#{n}" for n in unknown)
        )
    if not reviewable:
        return finalize_review(
            failed, gate, numbers, "deterministic-gate",
            "toutes les PRs sont FAIL au gate; revue IA non appelee",
        )

    handoff = load_json(HANDOFF_FILE)
    bundle, diff_holds = build_review_bundle(
        reviewable, gate_map, pr_metadata(), handoff
    )
    synthesized = dict(failed)
    synthesized.update(diff_holds)
    model_numbers = [item["number"] for item in bundle["reviewable_prs"]]

    if not model_numbers:
        return finalize_review(
            synthesized, gate, numbers, "deterministic-gate",
            "aucun diff disponible; PASS/HOLD bloques en HOLD",
            status="unavailable",
            attempts=[entry["reason"] for entry in diff_holds.values()],
        )

    models = model_chain()
    if not models:
        return finalize_fallback(
            "aucun modele resolu", synthesized, model_numbers, gate, numbers,
            ["aucun modele resolu"],
        )
    opencode = opencode_bin()
    if not opencode:
        return finalize_fallback(
            "binaire opencode introuvable", synthesized, model_numbers,
            gate, numbers, ["binaire opencode introuvable"],
        )

    try:
        write_json_atomic(AI_REVIEW_BUNDLE_FILE, bundle)
    except OSError as exc:
        return finalize_fallback(
            f"ecriture du bundle impossible: {exc}", synthesized,
            model_numbers, gate, numbers, [str(exc)],
        )

    stats = workload_stats(bundle)
    per_model_timeout = estimate_model_timeout(stats)
    total_deadline = estimate_total_deadline(len(models), per_model_timeout)
    wall_remaining = remaining_wall_budget()
    if wall_remaining <= 60:
        return finalize_fallback(
            "budget temps epuise avant l'appel des modeles", synthesized,
            model_numbers, gate, numbers, ["budget temps epuise"],
        )
    total_deadline = min(total_deadline, wall_remaining - 30)
    RUN_CONTEXT.update({
        "compact": COMPACT,
        "workload": stats,
        "per_model_timeout_s": per_model_timeout,
        "total_deadline_s": total_deadline,
        "wall_budget_remaining_s": wall_remaining,
        "model_count": len(models),
        "pending_prs": len(model_numbers),
    })
    print(
        f"AI_REVIEW_PLAN: {stats['pr_count']} PRs, "
        f"{stats['diff_chars']} diff chars, "
        f"{stats['handoff_chars']} handoff chars, "
        f"{per_model_timeout}s/modele, {total_deadline}s total, "
        f"{wall_remaining}s wall restant, compact={COMPACT}",
        flush=True,
    )

    deadline = time.monotonic() + total_deadline
    failures = []
    for index, model in enumerate(models, start=1):
        remaining = deadline - time.monotonic()
        if remaining <= 30:
            failures.append("deadline globale atteinte")
            break
        timeout = min(per_model_timeout, int(remaining))
        grace = max(0, min(MODEL_GRACE_S, int(remaining) - timeout))
        returncode, log_path = run_model(
            opencode, model, timeout, grace=grace
        )
        data = normalize_review(load_flexible_json(AI_REVIEW_PARTIAL_FILE))
        errors = policy.validate_ai_review(data, gate, model_numbers)
        if errors or not isinstance(data, dict):
            detail = "; ".join(errors) or "verdict IA illisible"
            if returncode != 0:
                detail = f"opencode rc={returncode}; {detail}"
            accepted = extract_valid_entries(data, gate_map, model_numbers)
            if accepted:
                synthesized.update(accepted)
                model_numbers = [
                    number for number in model_numbers
                    if number not in accepted
                ]
                pending = set(model_numbers)
                bundle["reviewable_prs"] = [
                    item for item in bundle["reviewable_prs"]
                    if item.get("number") in pending
                ]
                RUN_CONTEXT["pending_prs"] = len(model_numbers)
                RUN_CONTEXT["workload"] = workload_stats(bundle)
                print(
                    f"AI_REVIEW_PARTIAL_KEPT: {model}: "
                    f"{len(accepted)} verdicts valides conserves, "
                    f"{len(model_numbers)} PRs restantes",
                    flush=True,
                )
                failures.append(
                    f"{model}: {detail}; {len(accepted)} verdicts "
                    "valides conserves"
                )
                if os.path.exists(AI_REVIEW_PARTIAL_FILE):
                    os.remove(AI_REVIEW_PARTIAL_FILE)
                if not model_numbers:
                    final_entries = merge_review_entries(synthesized, None)
                    result = finalize_review(
                        {entry["number"]: entry for entry in final_entries},
                        gate, numbers, model,
                        f"verdicts partiels acceptes de {model} "
                        f"({len(accepted)} PRs)",
                    )
                    if result == 0 and os.path.exists(AI_REVIEW_FILE):
                        print(
                            f"AI_REVIEW_DONE: {model} ({index}/{len(models)}), "
                            f"{len(final_entries)} PRs via verdicts partiels",
                            flush=True,
                        )
                        return 0
                    break
                try:
                    write_json_atomic(AI_REVIEW_BUNDLE_FILE, bundle)
                except OSError as exc:
                    failures.append(
                        f"reecriture du bundle impossible: {exc}"
                    )
                    break
                continue
            failures.append(f"{model}: {detail}")
            print(f"AI_REVIEW_INVALID: {model}: {detail}", flush=True)
            print(f"AI_REVIEW_LOG_TAIL: {tail(log_path)}", flush=True)
            if os.path.exists(AI_REVIEW_PARTIAL_FILE):
                os.remove(AI_REVIEW_PARTIAL_FILE)
            continue
        if returncode != 0:
            print(
                f"AI_REVIEW_PARTIAL_ACCEPTED: {model} rc={returncode} "
                "mais le fichier partiel est complet et valide",
                flush=True,
            )

        final_entries = merge_review_entries(synthesized, data)
        note = ""
        if diff_holds:
            note = (
                f"; {len(diff_holds)} PR(s) HOLD car diff indisponible"
            )
        result = finalize_review(
            {entry["number"]: entry for entry in final_entries},
            gate, numbers, model, f"verdict produit par {model}{note}",
        )
        if result == 0 and os.path.exists(AI_REVIEW_FILE):
            print(
                f"AI_REVIEW_DONE: {model} ({index}/{len(models)}), "
                f"{len(final_entries)} PRs, {len(diff_holds)} HOLD diff",
                flush=True,
            )
            return 0
        failures.append(f"{model}: revue finale invalide")

    return finalize_fallback(
        "tous les modeles ont echoue", synthesized, model_numbers, gate,
        numbers, failures,
    )


if __name__ == "__main__":
    sys.exit(main())
