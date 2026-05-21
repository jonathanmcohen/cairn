#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Cairn v0.3.0 Plan 1 — collab WS-connect smoke. Verifies the collab
# infrastructure end to end against a REAL running stack (cairn + db +
# cairn-collab), in one run:
#
#   1. Bring up the full stack (`docker compose up -d --build`) — builds BOTH
#      the cairn and cairn-collab images. Wait for cairn `healthy` + confirm
#      cairn-collab logs "listening".
#   2. Bootstrap the first user + a page through `cairn` over HTTP (signup ->
#      credentials login -> create page), mirroring the v0.2.0 smokes.
#   3. Mint a REAL collab token from `GET /api/collab/token?pageId=` (the page
#      the user owns; `requirePageAccess` gates it).
#   4. Positive path: open a WebSocket to cairn-collab at document name =
#      pageId, send the Hocuspocus y-protocol Auth(Token) message with the real
#      token, and assert the server replies Auth(Authenticated).
#   5. Negative paths: a connect with NO auth message and a connect with a
#      TAMPERED token must NOT be authenticated (PermissionDenied / close /
#      error / timeout) — proving onAuthenticate/authorizeCollab is enforced.
#   6. Tear down (`docker compose down`).
#
# Bring-up: this script brings the stack up itself. It needs DB_PASSWORD,
# AUTH_SECRET and PUBLIC_URL; sensible defaults are provided for a local run.
#
# WS client: Node 22 ships a global `WebSocket`, so no `ws` package is needed.
# The Hocuspocus wire format is tiny and replicated inline (lib0-compatible
# LEB128 varuint + length-prefixed UTF-8 varstring):
#   client first message: varString(docName) varUint(2=Auth) varUint(0=Token)
#                          varString(token)
#   server auth reply:     varString(docName) varUint(2=Auth)
#                          varUint(2=Authenticated | 1=PermissionDenied) ...
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
EMAIL="collab-${SFX}@smoke.test"
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
  -d "{\"name\":\"Collab User\",\"email\":\"${EMAIL}\",\"password\":\"${PASS}\",\"workspaceName\":\"Collab WS\"}")"
echo "signup: $SIGNUP"
echo "$SIGNUP" | grep -q '"workspaceId"' || fail "signup failed ($SIGNUP)"
login
echo "session: $(curl -s -b "$JAR" "$BASE/api/auth/session")"

PAGE="$(curl -s -c "$JAR" -b "$JAR" -X POST "$BASE/api/pages" \
  -H 'content-type: application/json' -d '{"title":"Collab Page"}')"
PAGE_ID="$(echo "$PAGE" | sed -E 's/.*"id":"([0-9a-f-]{36})".*/\1/')"
[ -n "$PAGE_ID" ] && [ "$PAGE_ID" != "$PAGE" ] || fail "no page id ($PAGE)"
echo "PAGE_ID=$PAGE_ID"

# --- 3. mint a real collab token -------------------------------------------
say "3. mint a real collab token via /api/collab/token"
TOKRESP="$(curl -s -b "$JAR" "$BASE/api/collab/token?pageId=${PAGE_ID}")"
echo "token response: $TOKRESP"
TOKEN="$(echo "$TOKRESP" | sed -E 's/.*"token":"([^"]+)".*/\1/')"
[ -n "$TOKEN" ] && [ "$TOKEN" != "$TOKRESP" ] || fail "no token minted ($TOKRESP)"
echo "minted token (len ${#TOKEN})"

# A tampered token: flip the last char of the signature so the HMAC check fails.
BAD_TOKEN="${TOKEN%?}$([ "${TOKEN: -1}" = "a" ] && echo b || echo a)"

# --- 4/5. WS handshake: positive (real token) + negatives -------------------
# The Node helper opens a raw WebSocket, optionally sends the Auth(Token)
# message, and prints the server's verdict. Mode 'auth' => expect AUTHORIZED;
# mode 'none'/'bad' => expect REJECTED (not authorized).
ws_probe() {
  local mode="$1" token="$2"
  WS_URL="${COLLAB_HOST_URL}/${PAGE_ID}" WS_MODE="$mode" WS_TOKEN="$token" \
    node -e '
    const url = process.env.WS_URL;
    const mode = process.env.WS_MODE;        // "auth" | "none" | "bad"
    const token = process.env.WS_TOKEN || "";
    const docName = url.split("/").pop();

    // lib0-compatible LEB128 varuint + length-prefixed UTF-8 varstring.
    function writeVarUint(arr, n) {
      while (n > 127) { arr.push(128 | (n & 127)); n = Math.floor(n / 128); }
      arr.push(n & 127);
    }
    function writeVarString(arr, s) {
      const bytes = Buffer.from(s, "utf8");
      writeVarUint(arr, bytes.length);
      for (const b of bytes) arr.push(b);
    }
    function makeReader(buf) {
      let pos = 0;
      return {
        varUint() { let num = 0, mult = 1, r;
          do { r = buf[pos++]; num += (r & 127) * mult; mult *= 128; } while (r >= 128);
          return num; },
        varString() { const len = this.varUint(); const s = buf.toString("utf8", pos, pos + len); pos += len; return s; },
      };
    }

    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    let settled = false;
    const done = (verdict, code) => { if (settled) return; settled = true; console.log(verdict); try { ws.close(); } catch {} process.exit(code); };

    ws.onopen = () => {
      if (mode === "none") return;            // send nothing -> server must not authenticate us
      const arr = [];
      writeVarString(arr, docName);
      writeVarUint(arr, 2);                    // MessageType.Auth
      writeVarUint(arr, 0);                    // AuthMessageType.Token
      writeVarString(arr, token);
      ws.send(Uint8Array.from(arr));
    };

    ws.onmessage = (ev) => {
      const buf = Buffer.from(ev.data);
      const r = makeReader(buf);
      r.varString();                           // documentName echo
      const type = r.varUint();
      if (type !== 2) return;                  // not an Auth reply; ignore (sync/awareness)
      const sub = r.varUint();                 // 0=Token req, 1=PermissionDenied, 2=Authenticated
      if (sub === 2) done("AUTHORIZED", mode === "auth" ? 0 : 1);
      else if (sub === 1) done("REJECTED:PermissionDenied", mode === "auth" ? 1 : 0);
      // sub===0 is a token request; ignore (we already sent it / will not for none).
    };

    ws.onclose = () => done("REJECTED:closed", mode === "auth" ? 1 : 0);
    ws.onerror = () => done("REJECTED:error", mode === "auth" ? 1 : 0);
    // Hocuspocus authenticates promptly; if nothing arrives the connection is
    // not authorized -> a timeout counts as "not authorized".
    setTimeout(() => done("REJECTED:timeout", mode === "auth" ? 1 : 0), 8000);
  '
}

say "4. positive path: real token -> expect AUTHORIZED"
VERDICT="$(ws_probe auth "$TOKEN")" || fail "real-token connect was NOT authorized (got: ${VERDICT:-none})"
echo "real token -> $VERDICT"
[ "$VERDICT" = "AUTHORIZED" ] || fail "expected AUTHORIZED, got $VERDICT"
echo "OK: authorized WS connect with a real token succeeded"

say "5a. negative path: NO auth message -> expect rejected/not-authorized"
VERDICT="$(ws_probe none "")" || fail "tokenless connect helper exited nonzero unexpectedly"
echo "no token -> $VERDICT"
case "$VERDICT" in REJECTED:*) echo "OK: tokenless connect not authorized";; *) fail "tokenless connect was authorized ($VERDICT)";; esac

say "5b. negative path: TAMPERED token -> expect rejected/not-authorized"
VERDICT="$(ws_probe bad "$BAD_TOKEN")" || fail "bad-token connect helper exited nonzero unexpectedly"
echo "bad token -> $VERDICT"
case "$VERDICT" in REJECTED:*) echo "OK: tampered-token connect not authorized";; *) fail "tampered-token connect was authorized ($VERDICT)";; esac

say "ALL v0.3.0 COLLAB WS-CONNECT SMOKE CHECKS PASSED"
