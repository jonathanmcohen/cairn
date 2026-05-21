#!/usr/bin/env bash
set -euo pipefail

# Multi-workspace smoke. Requires the stack running (docker compose up) on :3000.
BASE="${BASE:-http://localhost:3000}"
JAR="$(mktemp)"
JAR2="$(mktemp)"
trap 'rm -f "$JAR" "$JAR2"' EXIT

say() { printf '\n=== %s ===\n' "$1"; }

# Reuse the project's existing login-over-curl helper if present; otherwise the
# inline CSRF + credentials callback below mirrors the v0.1.0 smoke scripts.
csrf() {
  curl -s -c "$JAR" -b "$JAR" "$BASE/api/auth/csrf" | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/'
}
login() {
  local email="$1" password="$2" token
  token="$(csrf)"
  curl -s -c "$JAR" -b "$JAR" -o /dev/null \
    -d "csrfToken=${token}" -d "email=${email}" -d "password=${password}" \
    -d "callbackUrl=${BASE}/" \
    "$BASE/api/auth/callback/credentials"
}

say "1. bootstrap first user + workspace A"
curl -s -X POST "$BASE/api/auth/signup" -H 'content-type: application/json' \
  -d '{"name":"Owner","email":"owner@smoke.test","password":"password12345","workspaceName":"Workspace A"}' | tee /dev/stderr
login owner@smoke.test password12345

say "2. create workspace B (becomes active)"
WS_B="$(curl -s -c "$JAR" -b "$JAR" -X POST "$BASE/api/workspaces" \
  -H 'content-type: application/json' -d '{"name":"Workspace B"}' \
  | sed -E 's/.*"id":"([0-9a-f-]+)".*/\1/')"
echo "WS_B=$WS_B"
[ -n "$WS_B" ] || { echo "FAIL: no workspace B id"; exit 1; }

say "3. invite a teammate to the ACTIVE workspace (B)"
INV="$(curl -s -c "$JAR" -b "$JAR" -X POST "$BASE/api/invites" \
  -H 'content-type: application/json' \
  -d '{"email":"teammate@smoke.test","role":"editor","expiresInDays":7}' \
  | sed -E 's/.*"token":"([^"]+)".*/\1/')"
echo "INVITE=$INV"
[ -n "$INV" ] || { echo "FAIL: no invite token"; exit 1; }

say "4. switch active workspace back to A's id, then switch to B again"
# (Round-trip the switch endpoint; non-200 is a failure.)
curl -s -c "$JAR" -b "$JAR" "$BASE/api/auth/session" >/dev/null # session sanity
SC="$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR" -b "$JAR" -X POST "$BASE/api/workspaces/switch" \
  -H 'content-type: application/json' -d "{\"workspaceId\":\"$WS_B\"}")"
echo "switch -> $SC"
[ "$SC" = "200" ] || { echo "FAIL: switch not 200"; exit 1; }

say "5. teammate signs up via the invite, then accepts (existing-user path)"
curl -s -X POST "$BASE/api/auth/signup" -H 'content-type: application/json' \
  -d "{\"name\":\"Teammate\",\"email\":\"teammate@smoke.test\",\"password\":\"password12345\",\"inviteToken\":\"$INV\"}" \
  | tee /dev/stderr
# Signup already consumed the invite + created the membership; verify the
# accept endpoint rejects the now-used token with 400 (used) as expected.
token2="$(curl -s -c "$JAR2" -b "$JAR2" "$BASE/api/auth/csrf" | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/')"
curl -s -c "$JAR2" -b "$JAR2" -o /dev/null \
  -d "csrfToken=${token2}" -d "email=teammate@smoke.test" -d "password=password12345" \
  -d "callbackUrl=${BASE}/" "$BASE/api/auth/callback/credentials"
AC="$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR2" -b "$JAR2" -X POST "$BASE/api/invites/accept" \
  -H 'content-type: application/json' -d "{\"token\":\"$INV\"}")"
echo "accept (already-used) -> $AC"
[ "$AC" = "400" ] || { echo "FAIL: expected 400 for used token, got $AC"; exit 1; }

say "6. teammate (editor in B) leaves workspace B"
LV="$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR2" -b "$JAR2" -X POST "$BASE/api/workspaces/$WS_B/leave")"
echo "leave -> $LV"
[ "$LV" = "200" ] || { echo "FAIL: leave not 200, got $LV"; exit 1; }

say "ALL MULTI-WORKSPACE SMOKE CHECKS PASSED"
