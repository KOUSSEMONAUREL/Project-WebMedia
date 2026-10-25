#!/usr/bin/env python3
"""Resolve live opencode models at job start. No hardcoded model IDs.

Pipeline:
  1. `opencode models opencode` -> actually served right now (live truth).
  2. models.dev registry -> capabilities (free + tool_call) + context ranking.
  3. Smoke-test candidates in order (`opencode run --model X "ping"`),
     in small parallel batches with a short timeout and a global deadline:
     dead models fail fast, live ones answer, the step never hangs.
  4. Export PRIMARY_MODEL / FALLBACK_MODEL / FALLBACK3_MODEL / FALLBACK4_MODEL
     to $GITHUB_ENV (or stdout as `export K=V` when run locally).

Fails fast (exit 1) with fewer than MIN_ALIVE wiring models, instead of
letting the whole agent chain die silently on stale hardcoded IDs.
The analysis agent uses PRIMARY first, then the remaining slots cascade
as fallbacks. Review is a deterministic code gate, not an LLM.
"""

import json
import os
import subprocess
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

PROVIDER = "opencode"
WANT_ALIVE = 4
MIN_ALIVE = 2
SMOKE_TIMEOUT_S = 90
SMOKE_PROMPT = "reply with the single word: pong"
REGISTRY_URL = "https://models.dev/api.json"
# Un modele mort doit echouer en secondes, pas monopoliser le step. Les
# smokes tournent par lots paralleles et la phase entiere est bornee: mieux
# vaut un echec explicite en <6 min qu'un timeout GitHub opaque a 10 min.
SMOKE_BATCH = 4
SMOKE_DEADLINE_S = 300
MAX_CANDIDATES = 12

ENV_SLOTS = ["PRIMARY_MODEL", "FALLBACK_MODEL", "FALLBACK3_MODEL", "FALLBACK4_MODEL"]

# Qualite modele: famille connue (deepseek v4, glm, ...) en premier, puis
# contexte, puis ordre alphabetique comme dernier recours. Le tri pur par
# contexte faisait remonter des modeles de second plan (grande fenetre, faible
# capacite de raisonnement) devant des modeles plus competents, et le
# debrouillage alphabetique finissait par choisir le propre nom de l'agent.
MODEL_QUALITY_TIER: dict[str, int] = {
    # Tier 0: modeles de reference (raisonnement + tool_call avances)
    "deepseek-v4": 0,
    "deepseek-v4.1": 0,
    "deepseek-v4.1-flash": 0,
    "deepseek-v4-flash": 0,
    "glm-5": 0,
    "glm-5.3": 0,
    "glm-5.3-flash": 0,
    # Tier 1: modeles solides connus
    "big-pickle": 1,
    "flint-40b": 1,
    "mimo-v2.6": 1,
    "nemotron-3.5": 1,
    "nemotron-3-ultra": 1,
    # Tier 2: tout le reste (dernier recours)
}


def model_tier(short: str) -> int:
    for prefix, tier in MODEL_QUALITY_TIER.items():
        if short.startswith(prefix):
            return tier
    return 2


def run(*args: str, timeout: int = 60) -> tuple[int, str]:
    try:
        p = subprocess.run(
            list(args), capture_output=True, text=True, timeout=timeout,
        )
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    except subprocess.TimeoutExpired as e:
        partial = ""
        for stream in (e.stdout, e.stderr):
            if stream:
                partial += stream if isinstance(stream, str) \
                    else stream.decode("utf-8", "replace")
        return 1, f"ERROR: timeout after {timeout}s; partial={partial[-600:]}"
    except OSError as e:
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
    started = time.monotonic()
    rc, out = run(
        "opencode", "run", "--print-logs", "--log-level", "ERROR",
        "--model", model, SMOKE_PROMPT,
        timeout=SMOKE_TIMEOUT_S,
    )
    elapsed = time.monotonic() - started
    ok = rc == 0 and "pong" in out.lower()
    print(f"  [{'OK' if ok else 'KO'}] {model} ({elapsed:.0f}s)", flush=True)
    if not ok:
        reason = " ".join(out.split())[-400:]
        print(f"       rc={rc} out={reason!r}", flush=True)
    return ok


def main() -> int:
    started = time.monotonic()
    ids = live_ids()
    if not ids:
        print("FAIL: aucun modele live retourne par opencode")
        return 1

    caps = registry_caps()
    # Le tri qualite s'applique toujours: si models.dev est injoignable, le
    # contexte vaut -1 et le nom tranche. Sans ca, l'ordre alphabetique du CLI
    # remettait les modeles faibles (beam-free) en tete.
    def key(mid: str) -> tuple[int, int, str]:
        short = mid.split("/", 1)[-1]
        return (
            model_tier(short),
            -caps.get(short, -1),
            mid,
        )

    ids.sort(key=key)
    ids = ids[:MAX_CANDIDATES]
    print("ordre: qualite (deepseek v4 / glm d'abord), puis contexte, puis nom")

    alive: list[str] = []
    idx = 0
    while (
        idx < len(ids)
        and len(alive) < WANT_ALIVE
        and time.monotonic() - started < SMOKE_DEADLINE_S
    ):
        batch = ids[idx: idx + SMOKE_BATCH]
        idx += len(batch)
        with ThreadPoolExecutor(max_workers=len(batch)) as pool:
            results = list(pool.map(smoke, batch))
        for mid, ok in zip(batch, results):
            if ok and len(alive) < WANT_ALIVE:
                alive.append(mid)

    if len(alive) < WANT_ALIVE:
        print(
            f"WARN: seulement {len(alive)} modele(s) vivant(s) en "
            f"{time.monotonic() - started:.0f}s "
            f"(cible {WANT_ALIVE}, min {MIN_ALIVE})",
            flush=True,
        )

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
