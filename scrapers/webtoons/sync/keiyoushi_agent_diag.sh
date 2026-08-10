#!/usr/bin/env bash
# Instrumente l'appel opencode pour capturer les logs machine de diagnostic.
# Usage: keiyoushi_agent_diag.sh [opencode run args...]
# Env: STEP_TAG (identifiant du step, ex: primary, fallback1, review1)
set +e

STEP_TAG="${STEP_TAG:-agent}"
DIAG_DIR="/tmp/keiyoushi_diag/$STEP_TAG"
mkdir -p "$DIAG_DIR"

echo "=== [diag] START $(date -u +%FT%TZ) step=$STEP_TAG ==="
echo "=== [diag] opencode $(opencode --version 2>/dev/null) ==="
echo "=== [diag] commande: opencode run --print-logs --log-level DEBUG $* ==="
START=$(date +%s)

opencode run --print-logs --log-level DEBUG "$@" 2>&1 | tee "$DIAG_DIR/opencode_full.log"
RC=${PIPESTATUS[0]}
END=$(date +%s)

echo "=== [diag] OPENCODE_EXIT=$RC (duree $((END-START))s) ==="
echo "=== [diag] handoff: $( [ -s "${HANDOFF_FILE:-}" ] && echo PRESENT || echo ABSENT ) ==="
echo "=== [diag] dernieres lignes opencode.log interne ==="
tail -120 ~/.local/share/opencode/log/opencode.log 2>/dev/null || echo "pas de log opencode interne"

{
  echo "--- free -m ---"
  free -m 2>/dev/null || true
  echo "--- meminfo ---"
  grep -E "MemTotal|MemFree|MemAvailable|SwapTotal|SwapFree" /proc/meminfo 2>/dev/null || true
  echo "--- OOM killer (dmesg) ---"
  { sudo dmesg 2>/dev/null || dmesg 2>/dev/null; } | tail -40 || echo "dmesg inaccessible"
  echo "--- top process opencode ---"
  ps -eo pid,rss,cmd --sort=-rss 2>/dev/null | grep -iE "opencode|bun|node" | head -5 || true
} > "$DIAG_DIR/machine.log" 2>&1

cp ~/.local/share/opencode/log/opencode.log "$DIAG_DIR/opencode_internal.log" 2>/dev/null || true

echo "=== [diag] fichiers diagnostiques: ==="
ls -la "$DIAG_DIR"
echo "=== [diag] END $(date -u +%FT%TZ) ==="
exit $RC
