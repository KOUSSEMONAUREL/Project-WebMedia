#!/usr/bin/env python3
"""Resolve live opencode models at job start. No hardcoded model IDs.

Pipeline:
  1. `opencode models opencode` -> actually served right now (live truth).
  2. models.dev registry -> capabilities (free + tool_call) + context ranking.
  3. Smoke-test candidates in order (`opencode run --model X "ping"`,
     short timeout): dead models fail in seconds, live ones answer.
  4. Export PRIMARY_MODEL / FALLBACK_MODEL / FALLBACK3_MODEL / FALLBACK4_MODEL
     to $GITHUB_ENV (or stdout as `export K=V` when run locally).

Fails fast (exit 1) with fewer than MIN_ALIVE wiring models, instead of
letting the whole agent chain die silently on stale hardcoded IDs.
Analysis uses PRIMARY first, review starts at FALLBACK (a different
model), remaining fallbacks cascade -- same contract as before.
"""

import json
import os
import subprocess
import sys
import urllib.request

PROVIDER = "opencode"
WANT_ALIVE = 4
MIN_ALIVE = 2
SMOKE_TIMEOUT_S = 90
SMOKE_PROMPT = "reply with the single word: pong"
REGISTRY_URL = "https://models.dev/api.json"

ENV_SLOTS = ["PRIMARY_MODEL", "FALLBACK_MODEL", "FALLBACK3_MODEL", "FALLBACK4_MODEL"]


def run(*args: str, timeout: int = 60) -> tuple[int, str]:
    try:
        p = subprocess.run(
            list(args), capture_output=True, text=True, timeout=timeout,
        )
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    except (OSError, subprocess.TimeoutExpired) as e:
        return 1, f"ERROR: {e}"


def live_ids() -> list[str]:
    rc, out = run("opencode", "models", PROVIDER, timeout=60)
    if rc != 0:
        print(f"WARN: `opencode models {PROVIDER}` failed:\n{out[-500:]}")
        return []
    ids = [ln.strip() for ln in out.splitlines() if "/" in ln.strip()]
    # dedup, keep order
    seen: set[str] = set()
    uniq = [i for i in ids if not (i in seen or seen.add(i))]
    print(f"live: {len(uniq)} modeles desservis par {PROVIDER}")
    return uniq


def registry_caps() -> dict[str, int]:
    """Map short model id -> context size, for free + tool_call models only.
    Empty dict when the registry is unreachable (degraded mode: CLI order)."""
    try:
        req = urllib.request.Request(
            REGISTRY_URL, headers={"User-Agent": "webmedia-ci/1.0"},
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.load(r)
        models = data.get(PROVIDER, {}).get("models", {})
        caps = {}
        for mid, m in models.items():
            cost = m.get("cost", {})
            if cost.get("input", 1) == 0 and cost.get("output", 1) == 0 \
                    and m.get("tool_call") is True:
                caps[mid] = m.get("limit", {}).get("context", 0) or 0
        print(f"registry: {len(caps)} modeles gratuits + tool_call")
        return caps
    except Exception as e:  # noqa: BLE001 - degraded mode must never crash
        print(f"WARN: models.dev injoignable ({e}), ordre CLI seul")
        return {}


def smoke(model: str) -> bool:
    rc, out = run(
        "opencode", "run", "--model", model, SMOKE_PROMPT,
        timeout=SMOKE_TIMEOUT_S,
    )
    ok = rc == 0 and "pong" in out.lower()
    print(f"  [{'OK' if ok else 'KO'}] {model}")
    return ok


def main() -> int:
    ids = live_ids()
    if not ids:
        print("FAIL: aucun modele live retourne par opencode")
        return 1

    caps = registry_caps()
    if caps:
        # short id used by the CLI is the part after 'opencode/'
        def key(mid: str) -> tuple[int, str]:
            short = mid.split("/", 1)[-1]
            return (-caps.get(short, -1), mid)

        ids.sort(key=key)
        print("ordre: filtre gratuit+tool_call, gros contexte d'abord")
    else:
        print("ordre: tel que retourne par le CLI (degrade)")

    alive: list[str] = []
    for mid in ids:
        if len(alive) >= WANT_ALIVE:
            break
        if smoke(mid):
            alive.append(mid)

    print(f"vivants: {len(alive)} (min requis: {MIN_ALIVE})")
    if len(alive) < MIN_ALIVE:
        print("FAIL: pas assez de modeles vivants, echec volontaire "
              "(au lieu d'une mort silencieuse en cascade)")
        return 1

    exports = {slot: alive[i] for i, slot in enumerate(ENV_SLOTS) if i < len(alive)}
    print("resolution:")
    for k, v in exports.items():
        print(f"  {k}={v}")

    github_env = os.environ.get("GITHUB_ENV")
    if github_env:
        with open(github_env, "a", encoding="utf-8") as f:
            for k, v in exports.items():
                f.write(f"{k}={v}\n")
        print(f"ecrit dans $GITHUB_ENV ({len(exports)} vars)")
    else:
        for k, v in exports.items():
            print(f"export {k}={v}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
