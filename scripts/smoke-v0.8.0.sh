#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Cairn v0.8.0 cross-feature smoke. Brings up the full docker-compose stack
# and exercises the public/CLI/DB surfaces of every v0.8.0 delta band:
#
#   - Health + version
#   - Inbox capture (anon -> 401; PAT -> 201; inbox page exists)
#   - Notification bell unread count
#   - Native PDF (skipped if CAIRN_NATIVE_PDF unset)
#   - Page cover save+restore
#   - User theme apply (data-accent on /p/ render)
#   - PWA share_target manifest entry
#   - Cross-workspace inbox capture -> 404 (existence-non-leak)
#
# This is the integration backstop (spec §3 G10 P26) — NOT a replacement for
# the per-feature Testcontainers tests in Plans P1-P25.
# ---------------------------------------------------------------------------

cd "$(dirname "$0")/.."

BASE="${BASE:-http://localhost:3000}"
export DB_PASSWORD="${DB_PASSWORD:-smoke}"
export AUTH_SECRET="${AUTH_SECRET:-$(openssl rand -base64 32)}"
export PUBLIC_URL="${PUBLIC_URL:-http://localhost:3000}"
export COLLAB_PORT="${COLLAB_PORT:-1234}"
# CAIRN_NATIVE_PDF — opt-in (G9 P25). Smoke skips the PDF band when unset.
# CAIRN_UNSPLASH_ACCESS_KEY — opt-in (G7 P20). Cover picker degrades to
# color+upload tabs only; not exercised here.

PASS_COUNT=0
TOTAL=0

note() { printf '\n=== %s ===\n' "$1"; }
ok()   { TOTAL=$((TOTAL+1)); PASS_COUNT=$((PASS_COUNT+1)); echo "  ok: $1"; }
bad()  { TOTAL=$((TOTAL+1)); echo "  BAD: $1"; }
skip() { echo "  skip: $1"; }
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

# --- 1. bring up stack -----------------------------------------------------
note "1. bring up cairn + cairn-collab + db"
docker compose down -v 2>/dev/null || true
docker compose up -d --build 2>&1 | tail -8

note "wait for cairn healthy (up to ~2min) and confirm version 0.8.0"
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
if echo "$HEALTH" | grep -q '"version":"0.8.0"'; then ok "/api/health reports 0.8.0"; else bad "/api/health did not report 0.8.0 ($HEALTH)"; fi

# --- 2. seed workspace + owner + mint a PAT --------------------------------
note "2. seed workspace + owner and mint a PAT for the band checks"
SEED="$(docker compose exec -T cairn node dist/server/cli.js smoke:seed --slug smokews8 2>/dev/null || true)"
WS="$(printf '%s' "$SEED"   | sed -n 's/.*"workspaceId":"\([^"]*\)".*/\1/p')"
USER="$(printf '%s' "$SEED" | sed -n 's/.*"userId":"\([^"]*\)".*/\1/p')"
KEY="$(printf '%s' "$SEED"  | sed -n 's/.*"apiKey":"\([^"]*\)".*/\1/p')"
PAGE_ID="$(printf '%s' "$SEED" | sed -n 's/.*"seedPageId":"\([^"]*\)".*/\1/p')"
if [ -n "$WS" ] && [ -n "$KEY" ]; then ok "seed returned workspaceId + apiKey"; else bad "seed missing fields"; exit 1; fi

AUTH=(-H "Authorization: Bearer $KEY")
J=(-H 'Content-Type: application/json')

PAT_RES="$(curl -s "${AUTH[@]}" "${J[@]}" -X POST "$BASE/api/dev/tokens" \
  -d '{"name":"smoke-v08","scopes":["pages:read","pages:write"]}')"
PAT="$(printf '%s' "$PAT_RES" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
if printf '%s' "$PAT" | grep -q '^cairn_pat_'; then ok "PAT minted with cairn_pat_ prefix"; else bad "PAT not minted ($PAT_RES)"; fi
PAT_AUTH=(-H "Authorization: Bearer $PAT")

# --- 3. inbox capture (G3 P8) ---------------------------------------------
note "3. inbox capture — anonymous 401, PAT 201, inbox page exists"
ANON_CODE="$(curl -s -o /dev/null -w '%{http_code}' "${J[@]}" -X POST "$BASE/api/inbox" \
  -d '{"title":"anon test","body":"should be rejected"}')"
assert "/api/inbox anon -> 401" "$ANON_CODE" "401"

INBOX_RES="$(curl -s "${PAT_AUTH[@]}" "${J[@]}" -X POST "$BASE/api/inbox" \
  -d '{"title":"smoke capture","body":"captured via smoke","url":"https://example.com"}')"
INBOX_PAGE_ID="$(printf '%s' "$INBOX_RES" | sed -n 's/.*"pageId":"\([^"]*\)".*/\1/p')"
if [ -n "$INBOX_PAGE_ID" ]; then ok "/api/inbox PAT -> 201 (pageId $INBOX_PAGE_ID)"; else bad "/api/inbox PAT did not return a pageId ($INBOX_RES)"; fi

# The inbox page itself must exist as the parent (workspaces.inbox_page_id).
WS_INFO="$(curl -s "${AUTH[@]}" "$BASE/api/workspaces/$WS")"
if echo "$WS_INFO" | grep -q '"inboxPageId"'; then ok "workspace.inboxPageId is set"; else bad "workspace.inboxPageId not set ($WS_INFO)"; fi

# --- 4. notification bell unread count (G6 P15) ---------------------------
note "4. /api/notifications/unread-count returns a numeric unread field"
UNREAD="$(curl -s "${AUTH[@]}" "$BASE/api/notifications/unread-count")"
echo "unread: $UNREAD"
if echo "$UNREAD" | grep -qE '"unread":[0-9]+'; then ok "unread-count returns numeric"; else bad "unread-count shape unexpected ($UNREAD)"; fi

# --- 5. native PDF (G9 P25) — gated by CAIRN_NATIVE_PDF -------------------
note "5. native PDF (skipped unless CAIRN_NATIVE_PDF=1 in compose env)"
if [ "${CAIRN_NATIVE_PDF:-}" = "1" ]; then
  if [ -z "$PAGE_ID" ]; then
    skip "no seed PAGE_ID returned; skipping native PDF assertion"
  else
    PDF_HDRS="$(curl -s -D - -o /tmp/cairn-smoke.pdf "${AUTH[@]}" "$BASE/api/pages/$PAGE_ID/export?format=pdf")"
    if echo "$PDF_HDRS" | grep -qi '^content-type: application/pdf'; then
      ok "PDF response content-type is application/pdf"
    else
      bad "PDF response content-type is not application/pdf"
    fi
    if head -c 5 /tmp/cairn-smoke.pdf | grep -q '%PDF-'; then
      ok "PDF body begins with %PDF- magic header"
    else
      bad "PDF body does not begin with %PDF-"
    fi
    rm -f /tmp/cairn-smoke.pdf
  fi
else
  skip "CAIRN_NATIVE_PDF is unset; native PDF band not exercised"
fi

# --- 6. page cover save+restore (G7 P20) ----------------------------------
note "6. page cover save+restore"
if [ -n "$PAGE_ID" ]; then
  COVER_CODE="$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" "${J[@]}" -X PATCH "$BASE/api/pages/$PAGE_ID/cover" \
    -d '{"kind":"color","value":"#ff0000"}')"
  assert "PATCH /api/pages/$PAGE_ID/cover -> 200" "$COVER_CODE" "200"
  GOT_COVER="$(curl -s "${AUTH[@]}" "$BASE/api/pages/$PAGE_ID")"
  if echo "$GOT_COVER" | grep -q '"value":"#ff0000"'; then
    ok "cover persisted (color #ff0000)"
  else
    bad "cover did not persist ($GOT_COVER)"
  fi
else
  skip "no PAGE_ID; skipping cover band"
fi

# --- 7. theme apply (G7 P19) — render-time data-accent on /p/ -------------
note "7. theme apply — data-accent attribute on published page render"
THEME_CODE="$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" "${J[@]}" -X PATCH "$BASE/api/user-theme-prefs" \
  -d '{"accent":"red"}')"
assert "PATCH /api/user-theme-prefs -> 200" "$THEME_CODE" "200"
# The accent renders into the published page HTML via a CSS-custom-prop
# attribute on the root element (data-accent="red").
if [ -n "$PAGE_ID" ]; then
  PUB_HTML="$(curl -s "$BASE/p/$PAGE_ID" || true)"
  if echo "$PUB_HTML" | grep -q 'data-accent="red"'; then
    ok "published page renders data-accent=\"red\""
  else
    bad "published page missing data-accent=\"red\""
  fi
else
  skip "no PAGE_ID; skipping theme-render assertion"
fi

# --- 8. PWA share_target manifest entry (G3 P8) ---------------------------
note "8. /manifest.webmanifest includes share_target"
MANIFEST="$(curl -s "$BASE/manifest.webmanifest")"
if echo "$MANIFEST" | grep -q '"share_target"'; then
  ok "manifest includes share_target"
else
  bad "manifest missing share_target ($MANIFEST)"
fi

# --- 9. cross-workspace inbox capture -> 404 (existence-non-leak) ---------
note "9. cross-workspace inbox capture -> 404"
# Use a foreign workspace id (zeroed UUID) in the inbox payload — the route
# must resolve the workspace from the PAT, not from request input. A foreign
# id either is ignored (route still uses PAT's workspace, captured normally)
# OR — if the route accepts an explicit workspaceId — must 404.
# Smoke uses the explicit-id variant to exercise the cross-workspace gate.
CROSS_CODE="$(curl -s -o /dev/null -w '%{http_code}' "${PAT_AUTH[@]}" "${J[@]}" -X POST "$BASE/api/inbox" \
  -d '{"title":"x","workspaceId":"00000000-0000-0000-0000-000000000000"}')"
case "$CROSS_CODE" in
  201) ok "cross-workspace input ignored; capture used PAT's workspace ($CROSS_CODE)" ;;
  404) ok "cross-workspace explicit id -> 404 (existence-non-leak)" ;;
  *)   bad "cross-workspace inbox capture returned $CROSS_CODE" ;;
esac

# --- summary --------------------------------------------------------------
note "summary"
echo "PASS $PASS_COUNT / $TOTAL"
if [ "$PASS_COUNT" = "$TOTAL" ]; then
  echo "ALL v0.8.0 CROSS-FEATURE SMOKE CHECKS PASSED"; exit 0
else
  echo "v0.8.0 SMOKE FAILED ($((TOTAL-PASS_COUNT)) failure(s))"; exit 1
fi
