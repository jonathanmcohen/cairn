#!/usr/bin/env bash
set -euo pipefail

# Public-sharing smoke. Requires the stack running (docker compose up) on :3000.
#
# Proves the full anonymous flow:
#   sign in -> create page -> upload an image -> create+embed a database ->
#   publish -> ANONYMOUS GET /p/<slug> (200, content, noindex, re-signed image URL) ->
#   ANONYMOUS GET /api/public/databases/<id> (200, rows) ->
#   unpublish -> both public paths 404.
#
# Login mirrors the v0.1.0 / Plan 2 smokes: bootstrap the first user via
# /api/auth/signup, then the credentials callback for a session cookie. A fresh
# request with NO cookie jar exercises the anonymous public surface.
BASE="${BASE:-http://localhost:3000}"
EMAIL="${SMOKE_EMAIL:-public-smoke@smoke.test}"
PASSWORD="${SMOKE_PASSWORD:-password12345}"
JAR="$(mktemp)"
TMP="$(mktemp -d)"
trap 'rm -rf "$JAR" "$TMP"' EXIT

say() { printf '\n=== %s ===\n' "$1"; }

csrf() {
  curl -s -c "$JAR" -b "$JAR" "$BASE/api/auth/csrf" | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/'
}
login() {
  local token
  token="$(csrf)"
  curl -s -c "$JAR" -b "$JAR" -o /dev/null \
    -d "csrfToken=${token}" -d "email=${EMAIL}" -d "password=${PASSWORD}" \
    -d "callbackUrl=${BASE}/" \
    "$BASE/api/auth/callback/credentials"
}

say "1. bootstrap first user + workspace, then sign in"
# Bootstrap is idempotent-ish: if the user already exists the signup 4xx's; we
# still attempt login afterwards so a re-run against a live DB works.
curl -s -X POST "$BASE/api/auth/signup" -H 'content-type: application/json' \
  -d "{\"name\":\"Public Smoke\",\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"workspaceName\":\"Public Smoke WS\"}" \
  >/dev/null || true
login
echo "signed in as ${EMAIL}"

say "2. create a page"
PAGE_ID="$(curl -s -c "$JAR" -b "$JAR" -X POST "$BASE/api/pages" \
  -H 'content-type: application/json' -d '{"title":"Smoke Public"}' \
  | sed -E 's/.*"id":"([0-9a-f-]{36})".*/\1/')"
echo "page=$PAGE_ID"
[ -n "$PAGE_ID" ] || { echo "FAIL: no page id"; exit 1; }

say "3. upload an image (capture fileId for the embedded cairnImage node)"
# 1x1 transparent PNG.
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\x0d\x0a\x2d\xb4\x00\x00\x00\x00IEND\xaeB`\x82' \
  > "$TMP/pixel.png"
UPLOAD="$(curl -s -c "$JAR" -b "$JAR" -X POST "$BASE/api/upload" -F "file=@$TMP/pixel.png;type=image/png")"
FILE_ID="$(echo "$UPLOAD" | sed -E 's/.*"file":\{"id":"([0-9a-f-]{36})".*/\1/')"
echo "fileId=$FILE_ID"
[ -n "$FILE_ID" ] || { echo "FAIL: no file id ($UPLOAD)"; exit 1; }

say "4. create a database on the page + one property + one row"
DB_ID="$(curl -s -c "$JAR" -b "$JAR" -X POST "$BASE/api/databases" \
  -H 'content-type: application/json' -d "{\"pageId\":\"$PAGE_ID\",\"name\":\"Smoke DB\"}" \
  | sed -E 's/.*"id":"([0-9a-f-]{36})".*/\1/')"
echo "databaseId=$DB_ID"
[ -n "$DB_ID" ] || { echo "FAIL: no database id"; exit 1; }
PROP_ID="$(curl -s -c "$JAR" -b "$JAR" -X POST "$BASE/api/databases/$DB_ID/properties" \
  -H 'content-type: application/json' -d '{"name":"Title","type":"text"}' \
  | sed -E 's/.*"id":"([0-9a-f-]{36})".*/\1/')"
echo "propertyId=$PROP_ID"
[ -n "$PROP_ID" ] || { echo "FAIL: no property id"; exit 1; }
curl -s -c "$JAR" -b "$JAR" -X POST "$BASE/api/databases/$DB_ID/rows" \
  -H 'content-type: application/json' -d "{\"cells\":{\"$PROP_ID\":\"Hello row\"}}" -o /dev/null
echo "row inserted"

say "5. PATCH page content: embed the image (with fileId) + the database node"
curl -s -c "$JAR" -b "$JAR" -X PATCH "$BASE/api/pages/$PAGE_ID" \
  -H 'content-type: application/json' \
  -d "{\"content\":{\"type\":\"doc\",\"content\":[
        {\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Smoke Public body\"}]},
        {\"type\":\"cairnImage\",\"attrs\":{\"src\":\"/api/files/$FILE_ID\",\"fileId\":\"$FILE_ID\",\"alt\":\"pixel\"}},
        {\"type\":\"database\",\"attrs\":{\"databaseId\":\"$DB_ID\"}}
      ]}}" -o /dev/null
echo "content embedded"

say "6. publish"
PUB="$(curl -s -c "$JAR" -b "$JAR" -X POST "$BASE/api/pages/$PAGE_ID/publish")"
SLUG="$(echo "$PUB" | sed -E 's/.*"slug":"([^"]+)".*/\1/')"
echo "slug=$SLUG"
[ -n "$SLUG" ] || { echo "FAIL: no slug ($PUB)"; exit 1; }

say "7. ANONYMOUS GET /p/<slug> (no cookie jar)"
CODE="$(curl -s -o "$TMP/pub.html" -w '%{http_code}' "$BASE/p/$SLUG")"
echo "GET /p/$SLUG (anon) -> $CODE"; test "$CODE" = "200"
grep -q "Smoke Public" "$TMP/pub.html" && echo "content present"
grep -q "noindex" "$TMP/pub.html" && echo "noindex present"
# A re-signed image URL should appear as /api/files/<id>?sig=...&exp=...
# Next serializes the node attrs into the RSC payload, where `&` is emitted as
# the JSON escape `&` (and `&amp;` in plain HTML attrs) — accept either form.
grep -Eq "/api/files/[^\"?]+\?sig=[0-9a-f]+(&|&amp;|\\\\u0026)exp=[0-9]+" "$TMP/pub.html" \
  && echo "signed image url present" \
  || { echo "FAIL: no re-signed image url in /p/<slug>"; exit 1; }

say "8. ANONYMOUS public database read returns rows (while published)"
DBCODE="$(curl -s -o "$TMP/db.json" -w '%{http_code}' "$BASE/api/public/databases/$DB_ID")"
echo "GET /api/public/databases/$DB_ID (anon, published) -> $DBCODE"; test "$DBCODE" = "200"
grep -q '"rows"' "$TMP/db.json" && echo "rows present"

say "9. unpublish, then both public paths 404"
curl -s -c "$JAR" -b "$JAR" -X POST "$BASE/api/pages/$PAGE_ID/unpublish" -o /dev/null
CODE="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/p/$SLUG")"
echo "GET /p/$SLUG (anon, unpublished) -> $CODE"; test "$CODE" = "404"
DBCODE="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/public/databases/$DB_ID")"
echo "GET /api/public/databases/$DB_ID (anon, unpublished) -> $DBCODE"; test "$DBCODE" = "404"

say "PUBLIC SHARING SMOKE OK"
