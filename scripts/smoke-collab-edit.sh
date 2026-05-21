#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Cairn v0.3.0 Plan 2 — collaborative-EDITING materialization smoke. Proves the
# full Yjs -> pages.content -> FTS -> /api/search round-trip against a REAL
# running stack (cairn + db + cairn-collab), in one run:
#
#   1. Bring up the full stack (`docker compose up -d --build`) — builds BOTH
#      the cairn and cairn-collab images. Wait for cairn `healthy` + confirm
#      cairn-collab logs "listening".
#   2. Bootstrap the first user + a page through `cairn` over HTTP (signup ->
#      credentials login -> create page), mirroring scripts/smoke-collab.sh.
#   3. Mint TWO real editor collab tokens for the SAME page via
#      `GET /api/collab/token?pageId=` (the page the user owns).
#   4. Two-client convergence: open two @hocuspocus/provider connections on the
#      same doc name (= pageId), each with its own Y.Doc. Client A inserts
#      "Alpha", client B inserts "Bravo" into the shared 'default' XML fragment.
#      Wait for sync; assert BOTH docs serialize to text containing BOTH words
#      (conflict-free convergence). Then destroy both providers — the last
#      disconnect triggers the server-side materialize flush.
#   5. Verify materialization: poll pages.content (and the trigger-maintained
#      content_text) until both "Alpha" and "Bravo" appear — proving the merged
#      Yjs doc landed in pages.content via onStoreDocument / last-disconnect
#      flush (fragment 'default', yjsStateToProseDoc).
#   6. Verify search: GET /api/search?q=Bravo (authenticated) returns the page,
#      proving Yjs -> pages.content -> FTS trigger -> /api/search is intact.
#   7. Tear down (`docker compose down`).
#
# Bring-up: this script brings the stack up itself. It needs DB_PASSWORD,
# AUTH_SECRET and PUBLIC_URL; sensible defaults are provided for a local run.
#
# Yjs client: uses the same @hocuspocus/provider + yjs the editor uses, driven
# from a throwaway Node harness. Text is inserted directly into the 'default'
# Y.XmlFragment as paragraph XmlElements — the exact structure y-prosemirror's
# yDocToProsemirrorJSON (the server's yjsStateToProseDoc, fragment 'default')
# reads back into ProseMirror JSON for pages.content.
# ---------------------------------------------------------------------------

cd "$(dirname "$0")/.."

BASE="${BASE:-http://localhost:3000}"
COLLAB_HOST_URL="${COLLAB_HOST_URL:-ws://localhost:${COLLAB_PORT:-1234}}"
export DB_PASSWORD="${DB_PASSWORD:-smoke}"
export AUTH_SECRET="${AUTH_SECRET:-$(openssl rand -base64 32)}"
export PUBLIC_URL="${PUBLIC_URL:-http://localhost:3000}"
export COLLAB_PORT="${COLLAB_PORT:-1234}"

JAR="$(mktemp)"
trap 'rm -f "$JAR"; echo; echo "=== tearing down stack ==="; docker compose down 2>/dev/null || true' EXIT

say()  { printf '\n=== %s ===\n' "$1"; }
fail() { echo "FAIL: $1"; exit 1; }

SFX="$(date +%s)"
EMAIL="collabedit-${SFX}@smoke.test"
PASS="password12345"

# --- 1. bring up the full stack --------------------------------------------
say "1. bring up cairn + db + cairn-collab (docker compose up -d --build)"
docker compose down -v 2>/dev/null || true
docker compose up -d --build 2>&1 | tail -8

say "wait for cairn healthy"
healthy=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
  s="$(docker compose ps cairn --format '{{.Health}}' 2>/dev/null || echo unknown)"
  echo "cairn: $s"
  if [ "$s" = "healthy" ]; then healthy=1; break; fi
  sleep 5
done
[ "$healthy" = "1" ] || fail "cairn never reached healthy"

say "confirm cairn-collab is listening"
listening=0
for _ in 1 2 3 4 5 6; do
  if docker compose logs cairn-collab 2>&1 | grep -qi "listening"; then listening=1; break; fi
  sleep 3
done
[ "$listening" = "1" ] || fail "cairn-collab never logged 'listening'"
echo "OK: cairn-collab is listening"

# --- 2. bootstrap user + page through cairn --------------------------------
say "2. bootstrap first user + a page via cairn HTTP API"
login() {
  local csrf
  csrf="$(curl -s -c "$JAR" -b "$JAR" "$BASE/api/auth/csrf" \
    | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/')"
  curl -s -c "$JAR" -b "$JAR" -o /dev/null \
    -d "csrfToken=${csrf}" -d "email=${EMAIL}" -d "password=${PASS}" \
    -d "callbackUrl=${BASE}/" \
    "$BASE/api/auth/callback/credentials"
}

SIGNUP="$(curl -s -X POST "$BASE/api/auth/signup" -H 'content-type: application/json' \
  -d "{\"name\":\"Collab Editor\",\"email\":\"${EMAIL}\",\"password\":\"${PASS}\",\"workspaceName\":\"Collab Edit WS\"}")"
echo "signup: $SIGNUP"
echo "$SIGNUP" | grep -q '"workspaceId"' || fail "signup failed ($SIGNUP)"
login
echo "session: $(curl -s -b "$JAR" "$BASE/api/auth/session")"

PAGE="$(curl -s -c "$JAR" -b "$JAR" -X POST "$BASE/api/pages" \
  -H 'content-type: application/json' -d '{"title":"Collab Edit Page"}')"
PAGE_ID="$(echo "$PAGE" | sed -E 's/.*"id":"([0-9a-f-]{36})".*/\1/')"
[ -n "$PAGE_ID" ] && [ "$PAGE_ID" != "$PAGE" ] || fail "no page id ($PAGE)"
echo "PAGE_ID=$PAGE_ID"

# --- 3. mint two real editor collab tokens for the same page ----------------
say "3. mint two editor collab tokens via /api/collab/token"
mint_token() {
  local resp
  resp="$(curl -s -b "$JAR" "$BASE/api/collab/token?pageId=${PAGE_ID}")"
  echo "$resp" | sed -E 's/.*"token":"([^"]+)".*/\1/'
}
TOKEN_A="$(mint_token)"
TOKEN_B="$(mint_token)"
[ -n "$TOKEN_A" ] || fail "no token A minted"
[ -n "$TOKEN_B" ] || fail "no token B minted"
echo "minted token A (len ${#TOKEN_A}), token B (len ${#TOKEN_B})"

# --- 4. two-client convergence + disconnect flush ---------------------------
# Two providers on the same doc; A inserts "Alpha", B inserts "Bravo". The
# harness asserts both docs converge (each contains BOTH words) before
# destroying the providers (triggering the server-side materialize flush).
say "4. two clients edit the shared doc -> assert convergence -> disconnect"
COLLAB_URL="$COLLAB_HOST_URL" PAGE_ID="$PAGE_ID" TOKEN_A="$TOKEN_A" TOKEN_B="$TOKEN_B" \
  node --input-type=module -e '
  import { HocuspocusProvider } from "@hocuspocus/provider";
  import { yDocToProsemirrorJSON } from "y-prosemirror";
  import * as Y from "yjs";

  const url = process.env.COLLAB_URL;
  const name = process.env.PAGE_ID;

  // Serialize the shared "default" XML fragment to plain text for assertions.
  const text = (ydoc) => {
    const json = yDocToProsemirrorJSON(ydoc, "default");
    const walk = (n) => (n.text ?? "") + (n.content ?? []).map(walk).join(" ");
    return walk(json);
  };

  const open = (token) =>
    new Promise((resolve, reject) => {
      const ydoc = new Y.Doc();
      const provider = new HocuspocusProvider({
        url, name, token, document: ydoc,
        onSynced: () => resolve({ ydoc, provider }),
        onAuthenticationFailed: (e) => reject(new Error("auth failed: " + JSON.stringify(e))),
      });
      setTimeout(() => reject(new Error("sync timeout")), 15000);
    });

  const insert = (ydoc, word) => {
    // Append a paragraph with the word into the live "default" fragment. We
    // build it via a fresh Y.Doc fragment and merge to keep both edits.
    const frag = ydoc.getXmlFragment("default");
    const p = new Y.XmlElement("paragraph");
    p.insert(0, [new Y.XmlText(word)]);
    ydoc.transact(() => frag.push([p]));
  };

  const main = async () => {
    const a = await open(process.env.TOKEN_A);
    const b = await open(process.env.TOKEN_B);

    insert(a.ydoc, "Alpha");
    insert(b.ydoc, "Bravo");

    // Allow the updates to propagate through the server to both clients.
    await new Promise((r) => setTimeout(r, 4000));

    const ta = text(a.ydoc);
    const tb = text(b.ydoc);
    console.log("client A doc text:", JSON.stringify(ta));
    console.log("client B doc text:", JSON.stringify(tb));

    const converged = (t) => t.includes("Alpha") && t.includes("Bravo");
    if (!converged(ta) || !converged(tb)) {
      console.error("NOT CONVERGED");
      a.provider.destroy(); b.provider.destroy();
      process.exit(1);
    }
    console.log("CONVERGED: both clients see Alpha + Bravo");

    // Destroy both providers; the last disconnect triggers the server flush.
    a.provider.destroy();
    b.provider.destroy();
    await new Promise((r) => setTimeout(r, 500));
    process.exit(0);
  };

  main().catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
  ' || fail "two-client convergence harness failed"
echo "OK: two clients converged on Alpha + Bravo"

# --- 5. verify materialization into pages.content --------------------------
say "5. poll pages.content (+ trigger-maintained content_text) for both words"
materialized=0
for i in 1 2 3 4 5 6 7 8 9 10; do
  ROW="$(docker compose exec -T db psql -U cairn -d cairn -tA -c \
    "SELECT content::text || '|||' || coalesce(content_text,'') FROM pages WHERE id = '${PAGE_ID}';" 2>/dev/null || echo "")"
  if echo "$ROW" | grep -q "Alpha" && echo "$ROW" | grep -q "Bravo"; then
    materialized=1
    echo "attempt $i: pages.content + content_text contain Alpha AND Bravo"
    break
  fi
  echo "attempt $i: not yet materialized; waiting..."
  sleep 2
done
[ "$materialized" = "1" ] || fail "pages.content never materialized Alpha + Bravo"
echo "content snippet:"
docker compose exec -T db psql -U cairn -d cairn -c \
  "SELECT left(content_text, 120) AS content_text, left(content::text, 200) AS content FROM pages WHERE id = '${PAGE_ID}';"
echo "OK: merged Yjs edits materialized into pages.content"

# --- 6. verify search finds the page ---------------------------------------
say "6. /api/search?q=Bravo (authenticated) finds the page"
SEARCH="$(curl -s -b "$JAR" "$BASE/api/search?q=Bravo")"
echo "search response: $(echo "$SEARCH" | head -c 400)"
echo "$SEARCH" | grep -q "$PAGE_ID" || fail "search did not return the page ($SEARCH)"
echo "OK: FTS (Yjs -> pages.content -> trigger -> /api/search) end-to-end intact"

say "ALL v0.3.0 COLLAB-EDIT MATERIALIZATION SMOKE CHECKS PASSED"
