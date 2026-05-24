#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Cairn v0.7.0 cross-feature smoke. Brings up the full docker-compose stack
# and exercises the public/CLI/DB surfaces of every v0.7.0 band:
#
#   - Health + version (incl. /healthz), PATs, MCP tools/list, semantic
#     search, automation rule fire, two-way connector API-shape per kind.
#
# This is the integration backstop (spec §7 P23) — NOT a replacement for the
# per-feature Testcontainers tests in Plans P1-P22.
#
# Bring-up: this script brings the stack up itself. It needs DB_PASSWORD,
# AUTH_SECRET and PUBLIC_URL; sensible defaults are provided for a local run.
# ---------------------------------------------------------------------------

cd "$(dirname "$0")/.."

BASE="${BASE:-http://localhost:3000}"
export DB_PASSWORD="${DB_PASSWORD:-smoke}"
export AUTH_SECRET="${AUTH_SECRET:-$(openssl rand -base64 32)}"
export PUBLIC_URL="${PUBLIC_URL:-http://localhost:3000}"
export COLLAB_PORT="${COLLAB_PORT:-1234}"
# CAIRN_BACKFILL_EMBEDDINGS opt-in (G4) — leave OFF in smoke; the on-write
# pipeline handles the seeded page.

PASS_COUNT=0
TOTAL=0

note() { printf '\n=== %s ===\n' "$1"; }
ok()   { TOTAL=$((TOTAL+1)); PASS_COUNT=$((PASS_COUNT+1)); echo "  ok: $1"; }
bad()  { TOTAL=$((TOTAL+1)); echo "  BAD: $1"; }
assert() {
  local label="$1" actual="$2" expected="$3"
  if [ "$actual" = "$expected" ]; then ok "$label ($actual)"; else bad "$label: got $actual, want $expected"; fi
}

cleanup() {
  echo
  echo "=== tearing down stack ==="
  docker compose down -v 2>/dev/null || true
}
trap cleanup EXIT

# --- 1. bring up cairn + db ------------------------------------------------
note "1. bring up cairn + cairn-collab + db"
docker compose down -v 2>/dev/null || true
docker compose up -d --build 2>&1 | tail -8

note "wait for cairn healthy (up to ~2min) and confirm version 0.7.0"
healthy=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24; do
  s="$(docker compose ps cairn --format '{{.Health}}' 2>/dev/null || echo unknown)"
  echo "cairn: $s"
  if [ "$s" = "healthy" ]; then healthy=1; break; fi
  sleep 5
done
if [ "$healthy" = "1" ]; then ok "cairn reached healthy"; else bad "cairn never reached healthy"; echo "SMOKE ABORTED"; exit 1; fi

HEALTH="$(curl -s "$BASE/api/health")"
echo "health: $HEALTH"
if echo "$HEALTH" | grep -q '"version":"0.7.0"'; then ok "/api/health reports 0.7.0"; else bad "/api/health did not report 0.7.0 ($HEALTH)"; fi

# G3 P9 — /healthz is open and reports db: ok + uptime_seconds.
HZ="$(curl -s "$BASE/healthz")"
echo "healthz: $HZ"
if echo "$HZ" | grep -q '"db":"ok"' && echo "$HZ" | grep -q '"uptime_seconds"'; then
  ok "/healthz reports db ok + uptime"
else
  bad "/healthz response missing fields ($HZ)"
fi

# --- 2. seed workspace + owner + a session token --------------------------
note "2. seed workspace + owner (via in-image CLI smoke seed)"
SEED="$(docker compose exec -T cairn node dist/server/cli.js smoke:seed --slug smokews7 2>/dev/null || true)"
WS="$(printf '%s' "$SEED"   | sed -n 's/.*"workspaceId":"\([^"]*\)".*/\1/p')"
USER="$(printf '%s' "$SEED" | sed -n 's/.*"userId":"\([^"]*\)".*/\1/p')"
KEY="$(printf '%s' "$SEED"  | sed -n 's/.*"apiKey":"\([^"]*\)".*/\1/p')"
if [ -n "$WS" ] && [ -n "$KEY" ]; then ok "seed returned workspaceId + apiKey"; else bad "seed missing fields"; exit 1; fi

AUTH=(-H "Authorization: Bearer $KEY")
J=(-H 'Content-Type: application/json')

# --- 3. PAT mint + MCP tools/list ------------------------------------------
note "3. mint a PAT then exercise MCP tools/list with it"
PAT_RES="$(curl -s "${AUTH[@]}" "${J[@]}" -X POST "$BASE/api/dev/tokens" \
  -d '{"name":"smoke","scopes":["mcp:read","pages:read"],"mcpTools":["pages.list","pages.read","search.fts","search.semantic"]}')"
PAT="$(printf '%s' "$PAT_RES" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
PAT_ID="$(printf '%s' "$PAT_RES" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
if printf '%s' "$PAT" | grep -q '^cairn_pat_'; then ok "PAT minted with cairn_pat_ prefix"; else bad "PAT not minted ($PAT_RES)"; fi

# /api/mcp tools/list — Streamable HTTP single endpoint (G2 P7).
MCP_LIST="$(curl -s "${J[@]}" -H "Authorization: Bearer $PAT" -X POST "$BASE/api/mcp" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')"
if echo "$MCP_LIST" | grep -q '"name":"pages.list"' && echo "$MCP_LIST" | grep -q '"name":"search.semantic"'; then
  ok "MCP tools/list returns the registry"
else
  bad "MCP tools/list missing expected tools ($MCP_LIST)"
fi

# Wrong-PAT envelope → 401 (existence-non-leak: 401, not the tool list).
MCP_BAD_CODE="$(curl -s -o /dev/null -w '%{http_code}' "${J[@]}" -H "Authorization: Bearer cairn_pat_INVALID" -X POST "$BASE/api/mcp" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')"
assert "/api/mcp wrong PAT -> 401" "$MCP_BAD_CODE" "401"

# Revoke the PAT and confirm subsequent calls fail.
curl -s "${AUTH[@]}" -X DELETE "$BASE/api/dev/tokens/$PAT_ID" >/dev/null
MCP_AFTER_REVOKE="$(curl -s -o /dev/null -w '%{http_code}' "${J[@]}" -H "Authorization: Bearer $PAT" -X POST "$BASE/api/mcp" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/list"}')"
assert "/api/mcp after PAT revoke -> 401" "$MCP_AFTER_REVOKE" "401"

# --- 4. semantic search (G4) ----------------------------------------------
note "4. seed a page, wait for embedding, hit search?mode=semantic"
PAGE="$(curl -s "${AUTH[@]}" "${J[@]}" -X POST "$BASE/api/v1/pages" \
  -d '{"title":"Capybara quarterly report","content":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Quarterly review of the capybara coffee bar finances and stocking plan."}]}]}}')"
PAGE_ID="$(printf '%s' "$PAGE" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
if [ -n "$PAGE_ID" ]; then ok "seeded page id $PAGE_ID"; else bad "page seed failed ($PAGE)"; fi

# The embedding is fire-and-forget post-commit (G4 P12). Poll the search endpoint.
sem=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  S="$(curl -s "${AUTH[@]}" "$BASE/api/search?mode=semantic&q=capybara+finance")"
  if echo "$S" | grep -q "$PAGE_ID"; then sem=1; break; fi
  sleep 2
done
if [ "$sem" = "1" ]; then ok "semantic search returns the seeded page"; else bad "semantic search did not return the seeded page within 20s"; fi

# --- 5. automation rule fires on row.created (G6) --------------------------
note "5. automation rule fires on row.created"
DB="$(curl -s "${AUTH[@]}" "${J[@]}" -X POST "$BASE/api/v1/databases" -d '{"name":"SmokeDB"}')"
DB_ID="$(printf '%s' "$DB" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
RULE="$(curl -s "${AUTH[@]}" "${J[@]}" -X POST "$BASE/api/automation/rules" \
  -d "{\"name\":\"smoke\",\"triggerEvent\":\"row.created\",\"condition\":{},\"actionType\":\"notify\",\"actionConfig\":{\"userId\":\"$USER\",\"message\":\"row created\"},\"enabled\":true}")"
if echo "$RULE" | grep -q '"triggerEvent":"row.created"'; then ok "automation rule created"; else bad "rule create failed ($RULE)"; fi
RULE_ID="$(printf '%s' "$RULE" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"

curl -s "${AUTH[@]}" "${J[@]}" -X POST "$BASE/api/v1/databases/$DB_ID/rows" -d '{"cells":{}}' >/dev/null

# Poll automation_runs via the runs list endpoint (P17/P18).
ran=0
for _ in 1 2 3 4 5; do
  R="$(curl -s "${AUTH[@]}" "$BASE/api/automation/runs?ruleId=$RULE_ID")"
  if echo "$R" | grep -q '"status":"success"'; then ran=1; break; fi
  sleep 2
done
if [ "$ran" = "1" ]; then ok "automation rule fired"; else bad "automation_runs row not observed within 10s"; fi

# --- 6. connectors API-shape per kind (G7) --------------------------------
note "6. connectors API-shape — register one per kind (OAuth skipped)"
# Sheets — POST a placeholder; the real OAuth dance is exercised in P20 tests.
CON_S="$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" "${J[@]}" -X POST "$BASE/api/connectors" \
  -d "{\"databaseId\":\"$DB_ID\",\"kind\":\"google_sheets\",\"syncConfig\":{\"spreadsheetId\":\"sheet-x\",\"sheetTitle\":\"Sheet1\",\"headerRow\":1,\"columnMap\":{},\"externalIdProperty\":\"x\"}}")"
case "$CON_S" in 200|201|400) ok "POST /api/connectors google_sheets responded ($CON_S)" ;; *) bad "google_sheets connector POST returned $CON_S" ;; esac

# Airtable — same shape; PAT field is optional at smoke time (the route validates separately).
CON_A="$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" "${J[@]}" -X POST "$BASE/api/connectors" \
  -d "{\"databaseId\":\"$DB_ID\",\"kind\":\"airtable\",\"syncConfig\":{\"baseId\":\"appX\",\"tableId\":\"tblX\",\"fieldMap\":{},\"externalIdProperty\":\"x\"}}")"
case "$CON_A" in 200|201|400|409) ok "POST /api/connectors airtable responded ($CON_A)" ;; *) bad "airtable connector POST returned $CON_A" ;; esac

# CSV — no auth.
CON_C="$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" "${J[@]}" -X POST "$BASE/api/connectors" \
  -d "{\"databaseId\":\"$DB_ID\",\"kind\":\"csv\",\"syncConfig\":{\"relativePath\":\"p.csv\",\"delimiter\":\",\",\"encoding\":\"utf8\",\"columnMap\":{},\"externalIdProperty\":\"x\"}}")"
case "$CON_C" in 200|201|400|409) ok "POST /api/connectors csv responded ($CON_C)" ;; *) bad "csv connector POST returned $CON_C" ;; esac

# Cross-workspace webhook receipts must 404 (existence-non-leak).
WEB_S_CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "x-goog-channel-token: 00000000-0000-0000-0000-000000000000:00000000-0000-0000-0000-000000000000" -H "x-goog-resource-state: change" "$BASE/api/connectors/sheets/drive-webhook")"
assert "Sheets webhook cross-workspace -> 404" "$WEB_S_CODE" "404"
WEB_A_CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/connectors/airtable/webhook?w=00000000-0000-0000-0000-000000000000&c=00000000-0000-0000-0000-000000000000")"
case "$WEB_A_CODE" in 401|404) ok "Airtable webhook cross-workspace -> 401/404 ($WEB_A_CODE)" ;; *) bad "Airtable webhook cross-workspace returned $WEB_A_CODE" ;; esac

# --- summary --------------------------------------------------------------
note "summary"
echo "PASS $PASS_COUNT / $TOTAL"
if [ "$PASS_COUNT" = "$TOTAL" ]; then
  echo "ALL v0.7.0 CROSS-FEATURE SMOKE CHECKS PASSED"; exit 0
else
  echo "v0.7.0 SMOKE FAILED ($((TOTAL-PASS_COUNT)) failure(s))"; exit 1
fi
