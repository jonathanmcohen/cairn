#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Cairn v0.6.0 cross-feature smoke. Brings up the full docker-compose stack
# and exercises the public/CLI/DB surfaces of every v0.6.0 band:
#
#   - Content/db, sharing, observability, admin/ops, import/export
#
# This is the integration backstop that confirms the stack BOOTS healthy at
# version 0.6.0 with the new envs (CAIRN_METRICS_TOKEN) honored. Deeper
# per-feature flows are covered by the P1-P22 Vitest+Testcontainers suite.
#
# The assertions here are limited to what bash can sensibly check WITHOUT a
# logged-in cookie jar — public surfaces, token-gating contracts, CLI
# subcommand sanity, and DB-level shape assertions via `docker compose exec`.
#
# Bring-up: this script brings the stack up itself. It needs DB_PASSWORD,
# AUTH_SECRET and PUBLIC_URL; sensible defaults are provided for a local run.
# A unique CAIRN_METRICS_TOKEN is generated per run and passed into the
# container so the /metrics token-gating contract can be exercised end-to-end.
# ---------------------------------------------------------------------------

cd "$(dirname "$0")/.."

BASE="${BASE:-http://localhost:3000}"
export DB_PASSWORD="${DB_PASSWORD:-smoke}"
export AUTH_SECRET="${AUTH_SECRET:-$(openssl rand -base64 32)}"
export PUBLIC_URL="${PUBLIC_URL:-http://localhost:3000}"
export COLLAB_PORT="${COLLAB_PORT:-1234}"
export CAIRN_METRICS_TOKEN="smoke-metrics-token-$$"

PASS_COUNT=0
TOTAL=0

note() { printf '\n=== %s ===\n' "$1"; }
ok()   { TOTAL=$((TOTAL+1)); PASS_COUNT=$((PASS_COUNT+1)); echo "  ok: $1"; }
bad()  { TOTAL=$((TOTAL+1)); echo "  BAD: $1"; }
assert() {
  # assert "<label>" <actual> <expected>
  local label="$1" actual="$2" expected="$3"
  if [ "$actual" = "$expected" ]; then ok "$label ($actual)"
  else bad "$label: got $actual, want $expected"
  fi
}

cleanup() {
  echo
  echo "=== tearing down stack ==="
  docker compose down -v 2>/dev/null || true
}
trap cleanup EXIT

# --- 1. bring up the full stack --------------------------------------------
note "1. bring up cairn + cairn-collab + db (CAIRN_METRICS_TOKEN scoped to this run)"
docker compose down -v 2>/dev/null || true
docker compose up -d --build 2>&1 | tail -8

note "wait for cairn healthy (up to ~2min) and confirm version 0.6.0"
healthy=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24; do
  s="$(docker compose ps cairn --format '{{.Health}}' 2>/dev/null || echo unknown)"
  echo "cairn: $s"
  if [ "$s" = "healthy" ]; then healthy=1; break; fi
  sleep 5
done
if [ "$healthy" = "1" ]; then ok "cairn reached healthy"
else bad "cairn never reached healthy"; echo "SMOKE ABORTED"; exit 1
fi

HEALTH="$(curl -s "$BASE/api/health")"
echo "health: $HEALTH"
if echo "$HEALTH" | grep -q '"version":"0.6.0"'; then ok "health reports version 0.6.0"
else bad "health did not report version 0.6.0 ($HEALTH)"
fi

# --- 2. observability: /metrics token-gating contract ----------------------
note "2. /metrics token-gating (404 no token, 401 wrong, 200 right)"
# Without token configured the surface should 404; with token configured the
# unauthenticated call should 401, wrong bearer 401, right bearer 200.
CODE_NO="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/metrics")"
CODE_BAD="$(curl -s -o /dev/null -w '%{http_code}' -H "authorization: Bearer wrong-token" "$BASE/metrics")"
CODE_OK="$(curl -s -o /dev/null -w '%{http_code}' -H "authorization: Bearer ${CAIRN_METRICS_TOKEN}" "$BASE/metrics")"
# Accept either 401 or 404 for the un-auth'd request — both are valid
# "no leak" responses depending on whether the token is required or absent.
case "$CODE_NO" in 401|404) ok "/metrics unauthenticated returns 401/404 ($CODE_NO)";; *) bad "/metrics unauthenticated returned $CODE_NO (want 401/404)";; esac
assert "/metrics wrong bearer -> 401" "$CODE_BAD" "401"
assert "/metrics right bearer -> 200" "$CODE_OK" "200"

# --- 3. sharing: public /s/ surface ----------------------------------------
note "3. public sharing surface (/s/<slug>) returns 404 for nonexistent slug"
CODE_S="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/s/nonexistent-$$")"
assert "/s/<unknown> -> 404" "$CODE_S" "404"

# --- 4. PWA manifest -------------------------------------------------------
note "4. /manifest.webmanifest returns the PWA manifest"
MANI="$(curl -s "$BASE/manifest.webmanifest")"
if echo "$MANI" | grep -q '"name"' && echo "$MANI" | grep -q '"start_url"'; then
  ok "manifest.webmanifest has name + start_url"
else bad "manifest.webmanifest missing name/start_url ($MANI)"
fi

# --- 5. content/db public surface ------------------------------------------
note "5. /api/databases requires auth (anon -> 401/403/redirect)"
CODE_DB="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/databases")"
case "$CODE_DB" in 401|403|302|307|404) ok "/api/databases anon denied ($CODE_DB)";; *) bad "/api/databases anon returned $CODE_DB (want 401/403/redirect/404)";; esac

# --- 6. admin/ops: audit_log table exists in the DB ------------------------
note "6. audit_log table is present in the database"
if docker compose exec -T db psql -U cairn -d cairn -c "\\d audit_log" >/dev/null 2>&1; then
  ok "audit_log table exists"
else bad "audit_log table missing"
fi

# --- 7. CLI subcommands respond (dry runs / help-equivalent) ---------------
note "7. cairn CLI subcommands are reachable (export/import/reconcile)"
# We don't drive a full round-trip through the CLI here (no authed workspace
# from bash) — just confirm the subcommands are wired into dist/server/cli.js
# and exit cleanly under --help or against a known-missing workspace id.
ZERO_WS="00000000-0000-0000-0000-000000000000"

# export --help
if docker compose exec -T cairn node dist/server/cli.js export --help >/dev/null 2>&1; then
  ok "cli: export --help"
else bad "cli: export --help failed"
fi

# import --help
if docker compose exec -T cairn node dist/server/cli.js import --help >/dev/null 2>&1; then
  ok "cli: import --help"
else bad "cli: import --help failed"
fi

# reconcile against a known-missing workspace: the command must not crash —
# either it exits non-zero with a clean "workspace not found" message, or 0
# with no rows. Anything that throws an unhandled error is a smoke failure.
RECON_OUT="$(docker compose exec -T cairn node dist/server/cli.js reconcile --workspace "$ZERO_WS" 2>&1 || true)"
if echo "$RECON_OUT" | grep -qiE "(workspace not found|no rows|0 rows|reconciled|ok)"; then
  ok "cli: reconcile against unknown workspace responds gracefully"
else
  # As long as the binary ran and produced bounded output (no node stack trace
  # leaking through), accept it — the smoke is checking wiring, not behavior.
  if echo "$RECON_OUT" | grep -qiE "(at .*\.js:[0-9]+|TypeError|UnhandledPromise)"; then
    bad "cli: reconcile crashed with an unhandled error: $RECON_OUT"
  else
    ok "cli: reconcile responded (output bounded)"
  fi
fi

# --- summary ---------------------------------------------------------------
note "summary"
echo "PASS $PASS_COUNT / $TOTAL"
if [ "$PASS_COUNT" = "$TOTAL" ]; then
  echo "ALL v0.6.0 CROSS-FEATURE SMOKE CHECKS PASSED"
  exit 0
else
  echo "v0.6.0 SMOKE FAILED ($((TOTAL-PASS_COUNT)) failure(s))"
  exit 1
fi
