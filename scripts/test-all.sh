#!/bin/bash
set -e

cd "$(dirname "$0")/.."
ROOT="$PWD"

echo "═══════════════════════════════════════"
echo "  WebMedia - Test Suite"
echo "═══════════════════════════════════════"

FAILED=0

run_test() {
    local name=$1
    shift
    echo ""
    echo "━━━ $name ━━━"
    cd "$ROOT"
    if "$@" 2>&1; then
        echo "  ✅ $name passed"
    else
        echo "  ❌ $name FAILED"
        FAILED=1
    fi
}

# Backend tests
run_test "Backend Routes" npm --prefix "$ROOT/backend" test -- --run

# Webtoon tests
run_test "Webtoon Runner" npx tsx --test "$ROOT/scrapers/webtoons/tests/runner.test.ts"

# Import-worker tests
run_test "Import Worker (MangaDex)" npx tsx --test "$ROOT/scrapers/import-worker/tests/mangadex.test.ts"
run_test "Import Worker (RoyalRoad)" npx tsx --test "$ROOT/scrapers/import-worker/tests/royalroad.test.ts"
run_test "Import Worker (Errors)" npx tsx --test "$ROOT/scrapers/import-worker/tests/errors.test.ts"

# Novel-worker tests
run_test "Novel Worker" npx tsx --test "$ROOT/scrapers/novel-worker/tests/index.test.ts"

# Scrapling-worker tests
run_test "Scrapling Worker" python3 "$ROOT/scrapers/scrapling-worker/tests/test_main.py"

echo ""
echo "═══════════════════════════════════════"
if [ $FAILED -eq 0 ]; then
    echo "  ✅ All tests passed!"
else
    echo "  ❌ Some tests failed"
fi
echo "═══════════════════════════════════════"
exit $FAILED
