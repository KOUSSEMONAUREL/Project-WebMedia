#!/usr/bin/env python3
"""Revue IA independante des PRs keiyoushi.

Le runner essaie les modeles dans le meme ordre que l'agent d'analyse:
PRIMARY_MODEL, FALLBACK_MODEL, GEMINI_MODEL, FALLBACK3_MODEL,
FALLBACK4_MODEL. Un modele n'est considere reussi que si le fichier de
verdict existe et passe la validation stricte de
`keiyoushi_review_policy`. Un modele qui sort 0 sans fichier valide est
donc traite comme un echec, et le modele suivant prend le relais.
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
LOG_DIR = os.environ.get("AI_REVIEW_LOG_DIR", "/tmp/keiyoushi-ai-review-logs")
PER_MODEL_TIMEOUT_S = int(os.environ.get("AI_REVIEW_MODEL_TIMEOUT_S", "900"))
TOTAL_DEADLINE_S = int(os.environ.get("AI_REVIEW_TOTAL_DEADLINE_S", "2700"))
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


def build_command(opencode, model):
    command = [opencode, "run", "--model", model]
    if model.startswith("google/"):
        command.append("--auto")
    else:
        command.extend(["--variant", "max", "--thinking", "--auto"])
    instruction = (
        f"Review every PR in {PR_LIST_FILE} against the deterministic gate "
        f"output {GATE_REVIEW_FILE} and the handoff {HANDOFF_FILE}. "
        f"Write the verdict JSON to {AI_REVIEW_FILE}. Follow the reviewer "
        "prompt exactly. Gate FAIL is final. Do not modify any repository "
        "file, do not commit, push, merge, comment, or close anything."
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


def run_model(opencode, model, timeout):
    os.makedirs(LOG_DIR, exist_ok=True)
    safe_model = "".join(
        char if char.isalnum() or char in "._-" else "_" for char in model
    )
    log_path = os.path.join(LOG_DIR, f"{safe_model}.log")
    if os.path.exists(AI_REVIEW_FILE):
        os.remove(AI_REVIEW_FILE)

    command = build_command(opencode, model)
    started = time.monotonic()
    print(f"AI_REVIEW_MODEL: {model} (timeout {timeout}s)", flush=True)
    with open(log_path, "w", encoding="utf-8", errors="replace") as log:
        process = subprocess.Popen(
            command,
            cwd=REPO_ROOT,
            stdout=log,
            stderr=subprocess.STDOUT,
            env=child_env(model),
            start_new_session=True,
        )
        try:
            returncode = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            stop_process(process)
            returncode = 124
        finally:
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
        if isinstance(reason, str) and len(reason) > 4000:
            entry["reason"] = reason[:4000]
    return data


def main():
    if os.path.exists(AI_REVIEW_FILE):
        try:
            os.remove(AI_REVIEW_FILE)
        except OSError as exc:
            print(f"AI_REVIEW_UNAVAILABLE: suppression impossible: {exc}")
            return 1
    numbers = pr_numbers()
    if not numbers:
        print("AI_REVIEW_SKIPPED: aucune PR a reviewer")
        return 0
    if not os.path.exists(PROMPT_FILE):
        print(f"AI_REVIEW_UNAVAILABLE: prompt absent: {PROMPT_FILE}")
        return 1
    if not os.path.exists(GATE_REVIEW_FILE):
        print(f"AI_REVIEW_UNAVAILABLE: gate absent: {GATE_REVIEW_FILE}")
        return 1

    gate = load_json(GATE_REVIEW_FILE)
    gate_map = policy.gate_entries(gate)
    missing_gate = [n for n in numbers if n not in gate_map]
    if missing_gate:
        print("AI_REVIEW_UNAVAILABLE: PRs sans verdict gate: "
              + ", ".join(f"#{n}" for n in missing_gate))
        return 1

    models = model_chain()
    if not models:
        print("AI_REVIEW_UNAVAILABLE: aucun modele resolu")
        return 1
    opencode = opencode_bin()
    if not opencode:
        print("AI_REVIEW_UNAVAILABLE: binaire opencode introuvable")
        return 1

    deadline = time.monotonic() + TOTAL_DEADLINE_S
    failures = []
    for index, model in enumerate(models, start=1):
        remaining = deadline - time.monotonic()
        if remaining <= 30:
            failures.append("deadline globale atteinte")
            break
        timeout = min(PER_MODEL_TIMEOUT_S, int(remaining))
        returncode, log_path = run_model(opencode, model, timeout)
        data = normalize_review(load_flexible_json(AI_REVIEW_FILE))
        errors = policy.validate_ai_review(data, gate, numbers)
        if returncode != 0:
            errors = [f"opencode rc={returncode}"] + errors
        if errors or not isinstance(data, dict):
            detail = "; ".join(errors) or "verdict IA illisible"
            failures.append(f"{model}: {detail}")
            print(f"AI_REVIEW_INVALID: {model}: {detail}", flush=True)
            print(f"AI_REVIEW_LOG_TAIL: {tail(log_path)}", flush=True)
            if os.path.exists(AI_REVIEW_FILE):
                os.remove(AI_REVIEW_FILE)
            continue

        data["reviewer_model"] = model
        data["reviewed_at"] = datetime.now(timezone.utc).isoformat()
        temporary = AI_REVIEW_FILE + ".tmp"
        with open(temporary, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2)
        os.replace(temporary, AI_REVIEW_FILE)
        print(
            f"AI_REVIEW_OK: {model} ({index}/{len(models)}), "
            f"{len(data.get('prs', []))} PRs",
            flush=True,
        )
        return 0

    print("AI_REVIEW_UNAVAILABLE: tous les modeles ont echoue")
    for failure in failures:
        print(f" - {failure}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
