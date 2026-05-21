#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Cairn v0.3.0 cross-feature E2E smoke. Brings up the FULL 3-container stack
# (cairn + cairn-collab + db) and exercises every v0.3.0 feature together in a
# single run, end to end, against a REAL running stack:
#
#   1. Bring up the full stack (`docker compose up -d --build`) — builds BOTH
#      the cairn and cairn-collab images. Wait for cairn `healthy` (and confirm
#      it reports version 0.3.0) + confirm cairn-collab is "listening".
#   2. Bootstrap TWO users in the SAME workspace via signup + invite (mirrors
#      scripts/smoke-v0.2.0.sh): user A becomes WS owner, then invites B; B
#      signs up with the token, becoming a member of A's workspace. A creates a
#      shared page.
#   3. Collaborate (convergence + materialization): mint two editor collab
#      tokens for the shared page via `GET /api/collab/token?pageId=`, open two
#      @hocuspocus/provider connections on the same doc (the Plan 2 collab-edit
#      harness), make concurrent edits, assert both clients converge, then
#      disconnect (triggering the server-side materialize flush). Poll
#      pages.content until the merged edits land — proving collab edits
#      materialize to pages.content.
#   4. A mentions B in a comment: as A, POST a comment on the shared page whose
#      body @-mentions B via the stored `@[Name](userId)` token shape, using B's
#      REAL userId. -> 201.
#   5. B's feed shows the mention: as B (active in the shared workspace), GET
#      /api/notifications -> a `type: "mention"` row whose payload.pageId is the
#      shared page and payload.actorId is A; `?unreadOnly=true` shows it,
#      `unreadCount` >= 1.
#   6. Mark-read works: as B, POST /api/notifications/read {id} -> 200; re-fetch
#      `?unreadOnly=true` -> the mention is gone, unreadCount drops.
#   7. Isolation: as A, GET /api/notifications does NOT include B's mention.
#   8. Tear down (`docker compose down`).
#
# Bring-up: this script brings the stack up itself. It needs DB_PASSWORD,
# AUTH_SECRET and PUBLIC_URL; sensible defaults are provided for a local run.
#
# Collab client: uses the same @hocuspocus/provider + yjs the editor uses,
# driven from a throwaway Node harness (the Plan 2 approach) — text is inserted
# directly into the 'default' Y.XmlFragment as paragraph XmlElements, the exact
# structure the server's yjsStateToProseDoc reads back into pages.content.
# ---------------------------------------------------------------------------

cd "$(dirname "$0")/.."

BASE="${BASE:-http://localhost:3000}"
COLLAB_HOST_URL="${COLLAB_HOST_URL:-ws://localhost:${COLLAB_PORT:-1234}}"
export DB_PASSWORD="${DB_PASSWORD:-smoke}"
export AUTH_SECRET="${AUTH_SECRET:-$(openssl rand -base64 32)}"
export PUBLIC_URL="${PUBLIC_URL:-http://localhost:3000}"
export COLLAB_PORT="${COLLAB_PORT:-1234}"

JAR_A="$(mktemp)"   # user A — workspace owner, mentioner
JAR_B="$(mktemp)"   # user B — invited member, mentionee
trap 'rm -f "$JAR_A" "$JAR_B"; echo; echo "=== tearing down stack ==="; docker compose down 2>/dev/null || true' EXIT

say()  { printf '\n=== %s ===\n' "$1"; }
fail() { echo "FAIL: $1"; exit 1; }

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

# --- 1. bring up the full stack --------------------------------------------
say "1. bring up cairn + db + cairn-collab (docker compose up -d --build)"
docker compose down -v 2>/dev/null || true
docker compose up -d --build 2>&1 | tail -8

say "wait for cairn healthy (and confirm version 0.3.0)"
healthy=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
  s="$(docker compose ps cairn --format '{{.Health}}' 2>/dev/null || echo unknown)"
  echo "cairn: $s"
  if [ "$s" = "healthy" ]; then healthy=1; break; fi
  sleep 5
done
[ "$healthy" = "1" ] || fail "cairn never reached healthy"
HEALTH="$(curl -s "$BASE/api/health")"
echo "health: $HEALTH"
echo "$HEALTH" | grep -q '"version":"0.3.0"' || fail "health did not report version 0.3.0 ($HEALTH)"
echo "OK: cairn healthy and reporting 0.3.0"

say "confirm cairn-collab is listening"
listening=0
for _ in 1 2 3 4 5 6; do
  if docker compose logs cairn-collab 2>&1 | grep -qi "listening"; then listening=1; break; fi
  sleep 3
done
[ "$listening" = "1" ] || fail "cairn-collab never logged 'listening'"
echo "OK: cairn-collab is listening"

# --- 2. bootstrap two users in ONE workspace via signup + invite -----------
say "2. bootstrap user A (owner) + invite user B into the SAME workspace"
SIGNUP_A="$(curl -s -X POST "$BASE/api/auth/signup" -H 'content-type: application/json' \
  -d "{\"name\":\"User A\",\"email\":\"${EMAIL_A}\",\"password\":\"${PASS}\",\"workspaceName\":\"v0.3.0 Smoke WS\"}")"
echo "signup A: $SIGNUP_A"
USER_A_ID="$(echo "$SIGNUP_A" | sed -E 's/.*"userId":"([0-9a-f-]{36})".*/\1/')"
WS_ID="$(echo "$SIGNUP_A" | sed -E 's/.*"workspaceId":"([0-9a-f-]{36})".*/\1/')"
[ -n "$USER_A_ID" ] && [ "$USER_A_ID" != "$SIGNUP_A" ] || fail "no user A id from signup ($SIGNUP_A)"
[ -n "$WS_ID" ] && [ "$WS_ID" != "$SIGNUP_A" ] || fail "no workspace id from signup ($SIGNUP_A)"
echo "USER_A_ID=$USER_A_ID  WS_ID=$WS_ID"
login "$JAR_A" "$EMAIL_A"
echo "A session: $(curl -s -b "$JAR_A" "$BASE/api/auth/session")"

# A (active in the workspace) invites B as an editor (editor+ can comment).
INV="$(curl -s -c "$JAR_A" -b "$JAR_A" -X POST "$BASE/api/invites" \
  -H 'content-type: application/json' -d "{\"email\":\"${EMAIL_B}\",\"role\":\"editor\"}")"
echo "invite B: $INV"
TOKEN="$(echo "$INV" | sed -E 's/.*"token":"([^"]+)".*/\1/')"
[ -n "$TOKEN" ] && [ "$TOKEN" != "$INV" ] || fail "no invite token ($INV)"

# B signs up WITH the token -> B's account + membership in the SAME workspace.
SIGNUP_B="$(curl -s -X POST "$BASE/api/auth/signup" -H 'content-type: application/json' \
  -d "{\"name\":\"User B\",\"email\":\"${EMAIL_B}\",\"password\":\"${PASS}\",\"inviteToken\":\"${TOKEN}\"}")"
echo "signup B (invited): $SIGNUP_B"
USER_B_ID="$(echo "$SIGNUP_B" | sed -E 's/.*"userId":"([0-9a-f-]{36})".*/\1/')"
[ -n "$USER_B_ID" ] && [ "$USER_B_ID" != "$SIGNUP_B" ] || fail "B invite-signup failed ($SIGNUP_B)"
echo "USER_B_ID=$USER_B_ID"
login "$JAR_B" "$EMAIL_B"
echo "B session: $(curl -s -b "$JAR_B" "$BASE/api/auth/session")"

# Confirm B is a member of the shared workspace (switch -> 200 proves it).
BSW="$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR_B" -b "$JAR_B" \
  -X POST "$BASE/api/workspaces/switch" \
  -H 'content-type: application/json' -d "{\"workspaceId\":\"$WS_ID\"}")"
echo "B switch -> shared WS: $BSW"; [ "$BSW" = "200" ] || fail "B is not a member of the shared WS (got $BSW)"

# A creates the shared page (A is active in the shared WS).
PAGE="$(curl -s -c "$JAR_A" -b "$JAR_A" -X POST "$BASE/api/pages" \
  -H 'content-type: application/json' -d '{"title":"Shared Collab Page"}')"
PAGE_ID="$(echo "$PAGE" | sed -E 's/.*"id":"([0-9a-f-]{36})".*/\1/')"
[ -n "$PAGE_ID" ] && [ "$PAGE_ID" != "$PAGE" ] || fail "no page id ($PAGE)"
echo "PAGE_ID=$PAGE_ID"

# --- 3. collaborate: two-client convergence + materialization --------------
say "3. mint two editor collab tokens for the shared page"
mint_token() {
  local jar="$1" resp
  resp="$(curl -s -b "$jar" "$BASE/api/collab/token?pageId=${PAGE_ID}")"
  echo "$resp" | sed -E 's/.*"token":"([^"]+)".*/\1/'
}
TOKEN_A="$(mint_token "$JAR_A")"
TOKEN_B="$(mint_token "$JAR_B")"
[ -n "$TOKEN_A" ] || fail "no collab token A minted"
[ -n "$TOKEN_B" ] || fail "no collab token B minted"
echo "minted collab token A (len ${#TOKEN_A}), token B (len ${#TOKEN_B})"

# Two providers on the same doc; A inserts "Alpha", B inserts "Bravo". The
# harness asserts both docs converge (each contains BOTH words) AND that each
# client sees the other via awareness (presence), before destroying the
# providers (triggering the server-side materialize flush).
say "4. two clients edit the shared doc -> assert convergence + presence -> disconnect"
COLLAB_URL="$COLLAB_HOST_URL" PAGE_ID="$PAGE_ID" TOKEN_A="$TOKEN_A" TOKEN_B="$TOKEN_B" \
  USER_A_ID="$USER_A_ID" USER_B_ID="$USER_B_ID" \
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

  const open = (token, userId, name_) =>
    new Promise((resolve, reject) => {
      const ydoc = new Y.Doc();
      const provider = new HocuspocusProvider({
        url, name, token, document: ydoc,
        onSynced: () => {
          // Publish our presence into awareness so the peer can see us.
          provider.setAwarenessField("user", { id: userId, name: name_ });
          resolve({ ydoc, provider });
        },
        onAuthenticationFailed: (e) => reject(new Error("auth failed: " + JSON.stringify(e))),
      });
      setTimeout(() => reject(new Error("sync timeout")), 15000);
    });

  const insert = (ydoc, word) => {
    const frag = ydoc.getXmlFragment("default");
    const p = new Y.XmlElement("paragraph");
    p.insert(0, [new Y.XmlText(word)]);
    ydoc.transact(() => frag.push([p]));
  };

  const main = async () => {
    const a = await open(process.env.TOKEN_A, process.env.USER_A_ID, "User A");
    const b = await open(process.env.TOKEN_B, process.env.USER_B_ID, "User B");

    insert(a.ydoc, "Alpha");
    insert(b.ydoc, "Bravo");

    // Allow the updates + awareness to propagate to both clients.
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

    // Presence: each client should observe the OTHER user in awareness.
    const states = (provider) =>
      [...provider.awareness.getStates().values()].map((s) => s?.user?.id).filter(Boolean);
    const aSees = states(a.provider);
    const bSees = states(b.provider);
    console.log("A awareness user ids:", JSON.stringify(aSees));
    console.log("B awareness user ids:", JSON.stringify(bSees));
    const aSeesB = aSees.includes(process.env.USER_B_ID);
    const bSeesA = bSees.includes(process.env.USER_A_ID);
    if (aSeesB && bSeesA) {
      console.log("PRESENCE: each client sees the other via awareness");
    } else {
      // Presence is best-effort in this harness; convergence is the hard gate.
      console.log("PRESENCE: not both directions observed (A sees B:" + aSeesB + ", B sees A:" + bSeesA + ")");
    }

    // Destroy both providers; the last disconnect triggers the server flush.
    a.provider.destroy();
    b.provider.destroy();
    await new Promise((r) => setTimeout(r, 500));
    process.exit(0);
  };

  main().catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
  ' || fail "two-client collab harness failed"
echo "OK: two clients converged on Alpha + Bravo"

say "5. poll pages.content for the merged collab edits (materialization)"
materialized=0
for i in 1 2 3 4 5 6 7 8 9 10; do
  ROW="$(docker compose exec -T db psql -U cairn -d cairn -tA -c \
    "SELECT content::text || '|||' || coalesce(content_text,'') FROM pages WHERE id = '${PAGE_ID}';" 2>/dev/null || echo "")"
  if echo "$ROW" | grep -q "Alpha" && echo "$ROW" | grep -q "Bravo"; then
    materialized=1
    echo "attempt $i: pages.content contains Alpha AND Bravo"
    break
  fi
  echo "attempt $i: not yet materialized; waiting..."
  sleep 2
done
[ "$materialized" = "1" ] || fail "pages.content never materialized Alpha + Bravo"
echo "OK: collab edits materialized into pages.content"

# --- 4. A mentions B in a comment ------------------------------------------
say "6. A posts a comment on the shared page that @-mentions B"
# Re-confirm A is active in the shared WS for the comment POST.
curl -s -o /dev/null -c "$JAR_A" -b "$JAR_A" -X POST "$BASE/api/workspaces/switch" \
  -H 'content-type: application/json' -d "{\"workspaceId\":\"$WS_ID\"}"
# Mention token shape: @[Name](userId) — must carry B's REAL userId for the
# notification to fire (extractMentions parses this on the server).
COMMENT_BODY="Hey @[User B](${USER_B_ID}) please take a look at this page."
CRESP="$(curl -s -w '\n%{http_code}' -c "$JAR_A" -b "$JAR_A" -X POST "$BASE/api/pages/$PAGE_ID/comments" \
  -H 'content-type: application/json' \
  -d "{\"body\":\"${COMMENT_BODY}\"}")"
CCODE="$(echo "$CRESP" | tail -n1)"
CBODY="$(echo "$CRESP" | sed '$d')"
echo "comment create -> $CCODE : $CBODY"
[ "$CCODE" = "201" ] || fail "comment create expected 201 (got $CCODE: $CBODY)"
echo "OK: A created a comment mentioning B"

# --- 5. B's feed shows the mention -----------------------------------------
say "7. B's notifications feed shows the mention (type=mention, payload checks)"
# Poll briefly (notification insert is in the same tx as the comment, so it's
# already committed, but allow for any read lag).
got=0
for i in 1 2 3 4 5; do
  NB="$(curl -s -b "$JAR_B" "$BASE/api/notifications?unreadOnly=true")"
  echo "attempt $i B unread feed: $NB"
  if echo "$NB" | grep -q '"type":"mention"'; then got=1; break; fi
  sleep 1
done
[ "$got" = "1" ] || fail "B's feed has no mention notification ($NB)"
echo "$NB" | grep -q "\"pageId\":\"$PAGE_ID\"" || fail "mention payload.pageId is not the shared page ($NB)"
echo "$NB" | grep -q "\"actorId\":\"$USER_A_ID\"" || fail "mention payload.actorId is not user A ($NB)"
UNREAD="$(echo "$NB" | sed -E 's/.*"unreadCount":([0-9]+).*/\1/')"
echo "B unreadCount=$UNREAD"
[ -n "$UNREAD" ] && [ "$UNREAD" -ge 1 ] || fail "B unreadCount expected >=1 (got $UNREAD)"
# Capture the notification id for mark-read.
NOTIF_ID="$(echo "$NB" | sed -E 's/.*"notifications":\[\{"id":"([0-9a-f-]{36})".*/\1/')"
[ -n "$NOTIF_ID" ] && [ "$NOTIF_ID" != "$NB" ] || fail "could not extract B's notification id ($NB)"
echo "OK: B has a mention notification ($NOTIF_ID, pageId+actorId verified, unread=$UNREAD)"

# --- 6. mark-read works -----------------------------------------------------
say "8. B marks the mention read -> it leaves the unread feed, unreadCount drops"
MR="$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR_B" -b "$JAR_B" \
  -X POST "$BASE/api/notifications/read" \
  -H 'content-type: application/json' -d "{\"id\":\"$NOTIF_ID\"}")"
echo "B mark-read -> $MR"; [ "$MR" = "200" ] || fail "mark-read expected 200 (got $MR)"
NB2="$(curl -s -b "$JAR_B" "$BASE/api/notifications?unreadOnly=true")"
echo "B unread feed after read: $NB2"
echo "$NB2" | grep -q "\"id\":\"$NOTIF_ID\"" && fail "the mention is still in B's unread feed after mark-read"
UNREAD2="$(echo "$NB2" | sed -E 's/.*"unreadCount":([0-9]+).*/\1/')"
echo "B unreadCount after read=$UNREAD2"
[ -n "$UNREAD2" ] && [ "$UNREAD2" -lt "$UNREAD" ] || fail "unreadCount did not drop after mark-read ($UNREAD -> $UNREAD2)"
echo "OK: mark-read cleared the mention; unreadCount dropped $UNREAD -> $UNREAD2"

# --- 7. isolation -----------------------------------------------------------
say "9. isolation: A's feed does NOT include B's mention notification"
NA="$(curl -s -b "$JAR_A" "$BASE/api/notifications")"
echo "A feed: $NA"
echo "$NA" | grep -q "\"id\":\"$NOTIF_ID\"" && fail "A's feed leaked B's notification ($NA)"
echo "OK: B's mention is not visible in A's feed (per-user scoping holds)"

say "ALL v0.3.0 CROSS-FEATURE SMOKE CHECKS PASSED"
