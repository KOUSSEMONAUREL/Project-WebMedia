#!/usr/bin/env bash
# Lance un agent keiyoushi sous `timeout` et nettoie les opencode orphelins.
# GitHub tue le shell au timeout du step, mais pas ses enfants: sans ce
# wrapper, un `opencode run` survit et le fallback suivant travaille sur le
# meme workspace en parallele.
set -uo pipefail

MODEL="${1:?modele requis}"
TIMEOUT_S="${2:?timeout requis}"
ISSUE="${3:?numero issue requis}"
PROMPT_FILE="${PROMPT_FILE:-${GITHUB_WORKSPACE:-.}/.github/prompts/keiyoushi-analysis.md}"

export PATH="$HOME/.opencode/bin:$PATH"

cleanup() {
  pkill -TERM -f '[o]pencode run --model' 2>/dev/null || true
  sleep 2
  pkill -KILL -f '[o]pencode run --model' 2>/dev/null || true
}
trap cleanup EXIT INT TERM

cleanup

args=(run --model "$MODEL")
case "$MODEL" in
  google/*) args+=(--auto) ;;
  *) args+=(--variant max --thinking --auto) ;;
esac
args+=(--file "$PROMPT_FILE" -- "Analyze issue #$ISSUE following the procedure in the prompt.")

echo "AGENT_START model=$MODEL timeout=${TIMEOUT_S}s issue=$ISSUE"
timeout --signal=TERM --kill-after=20s "${TIMEOUT_S}s" opencode "${args[@]}"
rc=$?
echo "AGENT_END model=$MODEL rc=$rc"
exit "$rc"
