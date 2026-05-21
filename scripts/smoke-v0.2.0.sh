#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Cross-feature v0.2.0 smoke. Walks EVERY v0.2.0 feature end to end against a
# real running stack with curl, in one run:
#
#   (a) OAuth provider list reflects configured env (fake google creds make the
#       google provider appear; github is unset and must be absent).
#   (b) Multi-workspace: create a second workspace, the create switches active,
#       a page in WS-B is invisible (404) from WS-A, switch back to WS-A.
#   (c) Invites: registration is invite-only after the first user. A invites B
#       to WS-A; B signs up with that token (account + WS-A membership created).
#       Then A invites B to WS-B and B (now an existing logged-in user) accepts
#       via /api/invites/accept -> 200 (the existing-user accept path).
#   (d) Leave: B (non-sole-owner) leaves WS-A (200); A (sole owner) is rejected
#       (409, no transfer/delete in 0.2.0).
#   (e) Public sharing: build a page in WS-A with an embedded image + inline
#       database, publish -> anonymous /p/<slug> (200, noindex, re-signed image
#       URL, anonymous public DB read 200) -> unpublish -> /p/<slug> 404.
#
# Requires the stack running on :3000, brought up with fake OAuth creds:
#   AUTH_GOOGLE_ID=fake AUTH_GOOGLE_SECRET=fake docker compose up -d --build
#
# Login mirrors the v0.1.0 / Plan 2 / Plan 3 smokes: bootstrap a user via
# /api/auth/signup, then a CSRF-protected credentials callback for a session
# cookie. TWO cookie jars are used because invite-accept needs a real second
# logged-in account. A request with NO jar exercises the anonymous surface.
# ---------------------------------------------------------------------------

BASE="${BASE:-http://localhost:3000}"
JAR_A="$(mktemp)"   # first user (workspace owner)
JAR_B="$(mktemp)"   # second user (invited member)
TMP="$(mktemp -d)"
trap 'rm -rf "$JAR_A" "$JAR_B" "$TMP"' EXIT

say() { printf '\n=== %s ===\n' "$1"; }
fail() { echo "FAIL: $1"; exit 1; }

# Unique-ish suffix so re-runs against a persisted DB don't collide on email.
SFX="$(date +%s)"
EMAIL_A="a-${SFX}@smoke.test"
EMAIL_B="b-${SFX}@smoke.test"
PASS="password12345"

# Log in via the credentials provider (CSRF token + cookie jar). $1=jar $2=email.
login() {
  local jar="$1" email="$2" csrf
  csrf="$(curl -s -c "$jar" -b "$jar" "$BASE/api/auth/csrf" \
    | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/')"
  curl -s -c "$jar" -b "$jar" -o /dev/null \
    -d "csrfToken=${csrf}" -d "email=${email}" -d "password=${PASS}" \
    -d "callbackUrl=${BASE}/" \
    "$BASE/api/auth/callback/credentials"
}

# --- (a) OAuth provider list ------------------------------------------------
say "(a) OAuth provider list reflects configured env"
PROV="$(curl -s "$BASE/api/auth/providers")"
echo "providers: $PROV"
echo "$PROV" | grep -q '"credentials"' || fail "credentials provider missing"
echo "$PROV" | grep -q '"google"'      || fail "google provider missing (was the stack started with AUTH_GOOGLE_ID/SECRET?)"
echo "$PROV" | grep -q '"github"'      && fail "github provider present but its env is unset"
echo "OK: google + credentials present, github absent"

# --- bootstrap user A (becomes owner of WS-A) -------------------------------
say "bootstrap user A (owner of WS-A)"
SIGNUP_A="$(curl -s -X POST "$BASE/api/auth/signup" -H 'content-type: application/json' \
  -d "{\"name\":\"User A\",\"email\":\"${EMAIL_A}\",\"password\":\"${PASS}\",\"workspaceName\":\"WS-A\"}")"
echo "signup A: $SIGNUP_A"
WSA_ID="$(echo "$SIGNUP_A" | sed -E 's/.*"workspaceId":"([0-9a-f-]{36})".*/\1/')"
[ -n "$WSA_ID" ] && [ "$WSA_ID" != "$SIGNUP_A" ] || fail "no WS-A id from signup"
echo "WSA_ID=$WSA_ID"
login "$JAR_A" "$EMAIL_A"
echo "A session: $(curl -s -b "$JAR_A" "$BASE/api/auth/session")"

# --- (b) second workspace + cross-workspace isolation -----------------------
say "(b) create WS-B (switches active), verify cross-workspace 404, switch back"
WSB="$(curl -s -c "$JAR_A" -b "$JAR_A" -X POST "$BASE/api/workspaces" \
  -H 'content-type: application/json' -d '{"name":"WS-B"}')"
echo "create WS-B: $WSB"
WSB_ID="$(echo "$WSB" | sed -E 's/.*"id":"([0-9a-f-]{36})".*/\1/')"
[ -n "$WSB_ID" ] && [ "$WSB_ID" != "$WSB" ] || fail "no WS-B id"
echo "WSB_ID=$WSB_ID"

# Active ws is now WS-B (create switched it). Create a page in WS-B.
PAGE_B="$(curl -s -c "$JAR_A" -b "$JAR_A" -X POST "$BASE/api/pages" \
  -H 'content-type: application/json' -d '{"title":"Secret in B"}')"
PAGE_B_ID="$(echo "$PAGE_B" | sed -E 's/.*"id":"([0-9a-f-]{36})".*/\1/')"
[ -n "$PAGE_B_ID" ] && [ "$PAGE_B_ID" != "$PAGE_B" ] || fail "no WS-B page id ($PAGE_B)"
echo "page in B: $PAGE_B_ID"

# Switch back to WS-A.
SC="$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR_A" -b "$JAR_A" \
  -X POST "$BASE/api/workspaces/switch" \
  -H 'content-type: application/json' -d "{\"workspaceId\":\"$WSA_ID\"}")"
echo "switch -> A: $SC"; [ "$SC" = "200" ] || fail "switch to WS-A not 200 (got $SC)"

# From WS-A, the WS-B page must be 404 (cross-workspace -> 404, not 403).
PC="$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR_A" "$BASE/api/pages/$PAGE_B_ID")"
echo "A reads B page -> $PC"; [ "$PC" = "404" ] || fail "cross-workspace read expected 404 (got $PC)"
echo "OK: workspace isolation enforced"

# --- (c) invite-signup + accept as an existing logged-in second user --------
# Registration is invite-only after the first user (the bootstrap owner). So we
# create B's account via an invite-signup, then exercise the genuine
# existing-logged-in-user accept path with a SECOND invite (to WS-B).
say "(c) A invites B to WS-A; B signs up with the token (account + membership)"
# A is active in WS-A here, so this invite is scoped to WS-A.
INV_A="$(curl -s -c "$JAR_A" -b "$JAR_A" -X POST "$BASE/api/invites" \
  -H 'content-type: application/json' -d "{\"email\":\"${EMAIL_B}\",\"role\":\"editor\"}")"
echo "invite to WS-A: $INV_A"
TOKEN_A="$(echo "$INV_A" | sed -E 's/.*"token":"([^"]+)".*/\1/')"
[ -n "$TOKEN_A" ] && [ "$TOKEN_A" != "$INV_A" ] || fail "no WS-A invite token ($INV_A)"

# B signs up WITH the token -> creates B's account + WS-A membership (consumes it).
SIGNUP_B="$(curl -s -X POST "$BASE/api/auth/signup" -H 'content-type: application/json' \
  -d "{\"name\":\"User B\",\"email\":\"${EMAIL_B}\",\"password\":\"${PASS}\",\"inviteToken\":\"${TOKEN_A}\"}")"
echo "signup B (invited): $SIGNUP_B"
echo "$SIGNUP_B" | grep -q '"userId"' || fail "B invite-signup failed ($SIGNUP_B)"
login "$JAR_B" "$EMAIL_B"
echo "B session: $(curl -s -b "$JAR_B" "$BASE/api/auth/session")"

# Confirm B is now a member of WS-A (switch -> 200 proves the membership).
BSW="$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR_B" -b "$JAR_B" \
  -X POST "$BASE/api/workspaces/switch" \
  -H 'content-type: application/json' -d "{\"workspaceId\":\"$WSA_ID\"}")"
echo "B switch -> WS-A: $BSW"; [ "$BSW" = "200" ] || fail "B is not a member of WS-A (got $BSW)"
echo "OK: B joined WS-A via invite-signup"

say "(c) existing-user accept: A invites B to WS-B; B accepts -> 200"
# A switches to WS-B so the next invite is scoped to WS-B (invites target the
# caller's ACTIVE workspace).
curl -s -o /dev/null -c "$JAR_A" -b "$JAR_A" -X POST "$BASE/api/workspaces/switch" \
  -H 'content-type: application/json' -d "{\"workspaceId\":\"$WSB_ID\"}"
INV_B="$(curl -s -c "$JAR_A" -b "$JAR_A" -X POST "$BASE/api/invites" \
  -H 'content-type: application/json' -d "{\"email\":\"${EMAIL_B}\",\"role\":\"editor\"}")"
echo "invite to WS-B: $INV_B"
TOKEN_B="$(echo "$INV_B" | sed -E 's/.*"token":"([^"]+)".*/\1/')"
[ -n "$TOKEN_B" ] && [ "$TOKEN_B" != "$INV_B" ] || fail "no WS-B invite token ($INV_B)"

# B (existing logged-in user) accepts -> 200, active ws switches to WS-B.
AC="$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR_B" -b "$JAR_B" \
  -X POST "$BASE/api/invites/accept" \
  -H 'content-type: application/json' -d "{\"token\":\"$TOKEN_B\"}")"
echo "B accept invite (WS-B) -> $AC"; [ "$AC" = "200" ] || fail "B accept expected 200 (got $AC)"
echo "OK: B accepted WS-B invite as an existing user"

# A switches back to WS-A for the leave + publish steps.
curl -s -o /dev/null -c "$JAR_A" -b "$JAR_A" -X POST "$BASE/api/workspaces/switch" \
  -H 'content-type: application/json' -d "{\"workspaceId\":\"$WSA_ID\"}"

# --- (d) leave + sole-owner rejection ---------------------------------------
say "(d) B leaves WS-A (200); A (sole owner) rejected (409)"
LB="$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR_B" -b "$JAR_B" \
  -X POST "$BASE/api/workspaces/$WSA_ID/leave")"
echo "B leave WS-A -> $LB"; [ "$LB" = "200" ] || fail "B leave expected 200 (got $LB)"

LA="$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR_A" -b "$JAR_A" \
  -X POST "$BASE/api/workspaces/$WSA_ID/leave")"
echo "A (sole owner) leave WS-A -> $LA"
case "$LA" in 4??) echo "OK: sole-owner leave rejected ($LA)";; *) fail "sole-owner leave expected 4xx (got $LA)";; esac

# --- (e) publish -> anon /p/<slug> -> unpublish 404 -------------------------
say "(e) publish flow in WS-A (image + read-only DB) -> anon -> unpublish 404"
# Re-confirm A is active in WS-A (the create-WS-B switch + later steps left it on A).
curl -s -o /dev/null -c "$JAR_A" -b "$JAR_A" -X POST "$BASE/api/workspaces/switch" \
  -H 'content-type: application/json' -d "{\"workspaceId\":\"$WSA_ID\"}"

PAGE_PUB="$(curl -s -c "$JAR_A" -b "$JAR_A" -X POST "$BASE/api/pages" \
  -H 'content-type: application/json' -d '{"title":"Public Roadmap"}')"
PAGE_PUB_ID="$(echo "$PAGE_PUB" | sed -E 's/.*"id":"([0-9a-f-]{36})".*/\1/')"
[ -n "$PAGE_PUB_ID" ] && [ "$PAGE_PUB_ID" != "$PAGE_PUB" ] || fail "no page-to-publish id"
echo "page to publish: $PAGE_PUB_ID"

# Upload a 1x1 PNG -> fileId for the embedded cairnImage node.
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\x0d\x0a\x2d\xb4\x00\x00\x00\x00IEND\xaeB`\x82' \
  > "$TMP/pixel.png"
UPLOAD="$(curl -s -c "$JAR_A" -b "$JAR_A" -X POST "$BASE/api/upload" -F "file=@$TMP/pixel.png;type=image/png")"
FILE_ID="$(echo "$UPLOAD" | sed -E 's/.*"file":\{"id":"([0-9a-f-]{36})".*/\1/')"
[ -n "$FILE_ID" ] && [ "$FILE_ID" != "$UPLOAD" ] || fail "no file id ($UPLOAD)"
echo "fileId=$FILE_ID"

# Inline database on the page + one text property + one row.
DB_ID="$(curl -s -c "$JAR_A" -b "$JAR_A" -X POST "$BASE/api/databases" \
  -H 'content-type: application/json' -d "{\"pageId\":\"$PAGE_PUB_ID\",\"name\":\"Roadmap DB\"}" \
  | sed -E 's/.*"id":"([0-9a-f-]{36})".*/\1/')"
[ -n "$DB_ID" ] || fail "no database id"
echo "databaseId=$DB_ID"
PROP_ID="$(curl -s -c "$JAR_A" -b "$JAR_A" -X POST "$BASE/api/databases/$DB_ID/properties" \
  -H 'content-type: application/json' -d '{"name":"Title","type":"text"}' \
  | sed -E 's/.*"id":"([0-9a-f-]{36})".*/\1/')"
[ -n "$PROP_ID" ] || fail "no property id"
curl -s -c "$JAR_A" -b "$JAR_A" -X POST "$BASE/api/databases/$DB_ID/rows" \
  -H 'content-type: application/json' -d "{\"cells\":{\"$PROP_ID\":\"Ship it\"}}" -o /dev/null

# Embed the image (with fileId) + the database node into the page content.
curl -s -c "$JAR_A" -b "$JAR_A" -X PATCH "$BASE/api/pages/$PAGE_PUB_ID" \
  -H 'content-type: application/json' \
  -d "{\"content\":{\"type\":\"doc\",\"content\":[
        {\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Public Roadmap body\"}]},
        {\"type\":\"cairnImage\",\"attrs\":{\"src\":\"/api/files/$FILE_ID\",\"fileId\":\"$FILE_ID\",\"alt\":\"pixel\"}},
        {\"type\":\"database\",\"attrs\":{\"databaseId\":\"$DB_ID\"}}
      ]}}" -o /dev/null

# Publish.
PUB="$(curl -s -c "$JAR_A" -b "$JAR_A" -X POST "$BASE/api/pages/$PAGE_PUB_ID/publish")"
echo "publish: $PUB"
SLUG="$(echo "$PUB" | sed -E 's/.*"slug":"([^"]+)".*/\1/')"
[ -n "$SLUG" ] && [ "$SLUG" != "$PUB" ] || fail "no slug ($PUB)"
echo "slug=$SLUG"

# Anonymous /p/<slug> (no cookie jar) -> 200, content + noindex.
CODE="$(curl -s -o "$TMP/pub.html" -w '%{http_code}' "$BASE/p/$SLUG")"
echo "GET /p/$SLUG (anon) -> $CODE"; [ "$CODE" = "200" ] || fail "anon /p expected 200 (got $CODE)"
grep -q "Public Roadmap" "$TMP/pub.html" && echo "content present"      || fail "page content missing"
grep -qi "noindex" "$TMP/pub.html"       && echo "noindex present"      || fail "noindex meta missing"
# Re-signed image URL appears as /api/files/<id>?sig=...&exp=...; Next serializes
# `&` into the RSC payload as `&` / `&amp;` / `&` -> accept any form.
grep -Eq "/api/files/[^\"?]+\?sig=[0-9a-f]+(&|&amp;|\\\\u0026)exp=[0-9]+" "$TMP/pub.html" \
  && echo "signed image url present" \
  || fail "no re-signed image url in /p/<slug>"

# The re-minted signed image URL must be reachable anonymously.
IMG="$(curl -s "$BASE/p/$SLUG" \
  | grep -oE "/api/files/[^\"?]+\?sig=[0-9a-f]+(&|&amp;|\\\\u0026)exp=[0-9]+" | head -1 \
  | sed -e 's/&amp;/\&/g' -e 's/\\u0026/\&/g')"
echo "signed image url: $IMG"
[ -n "$IMG" ] || fail "could not extract signed image url"
ICODE="$(curl -s -o /dev/null -w '%{http_code}' "$BASE$IMG")"
echo "anon image -> $ICODE"; [ "$ICODE" = "200" ] || fail "anon image expected 200 (got $ICODE)"

# The read-only embedded database must be reachable anonymously while published.
DBCODE="$(curl -s -o "$TMP/db.json" -w '%{http_code}' "$BASE/api/public/databases/$DB_ID")"
echo "anon public db read -> $DBCODE"; [ "$DBCODE" = "200" ] || fail "anon public db expected 200 (got $DBCODE)"
grep -q '"rows"' "$TMP/db.json" && echo "rows present" || fail "public db missing rows"

# Unpublish -> /p/<slug> and the public db both 404.
curl -s -o /dev/null -c "$JAR_A" -b "$JAR_A" -X POST "$BASE/api/pages/$PAGE_PUB_ID/unpublish"
UCODE="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/p/$SLUG")"
echo "GET /p/$SLUG (anon, unpublished) -> $UCODE"; [ "$UCODE" = "404" ] || fail "post-unpublish /p expected 404 (got $UCODE)"
UDBCODE="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/public/databases/$DB_ID")"
echo "anon public db (unpublished) -> $UDBCODE"; [ "$UDBCODE" = "404" ] || fail "post-unpublish public db expected 404 (got $UDBCODE)"

say "ALL v0.2.0 CROSS-FEATURE SMOKE CHECKS PASSED"
