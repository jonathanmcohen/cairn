# MCP server — OAuth setup

Cairn ships a built-in **Model Context Protocol (MCP)** server at `/api/mcp` so AI
clients like **Claude Desktop** and **Cursor** can read and edit your workspace
through Cairn's tools. As of **v0.9.16**, the recommended way to connect is
**OAuth 2.1** — you add a URL, click **Allow** in your browser, and you're done.
No token to paste.

Personal access tokens (PATs) still work and are fully supported; see
[Bearer-token setup](#bearer-token-setup-pats) below.

## OAuth (recommended)

### What you need

- Your Cairn server's public URL, e.g. `https://notes.example.com`.
- The MCP endpoint URL: `https://notes.example.com/api/mcp`.

### Claude Desktop / Cursor

1. In your client, add an MCP server with just the URL `https://<your-host>/api/mcp`
   — **no Authorization header**.
2. The client probes the endpoint, sees a `401` with a `WWW-Authenticate` header,
   and discovers Cairn's authorization server automatically.
3. Your browser opens to the Cairn **consent screen**. It shows:
   - the **app** that's connecting (e.g. "Cursor"),
   - the **workspace** it will access,
   - the **permissions** (scopes) it's requesting.
4. Click **Allow**. The client receives a short-lived access token and a rotating
   refresh token — Cairn never shows you a secret to copy.
5. The server connects. `tools/list` returns Cairn's tools and you can start using
   them.

> The scopes a connection receives are **intersected with your workspace role** at
> consent time. A viewer can never grant write access, even if the app asks for it.

### Managing connected apps

Go to **Settings → Developer → Personal tokens**. The **Connected apps** list
shows each app you've authorized over OAuth, the scopes it holds, and when it was
last used. Click **Revoke** to disconnect an app — its next request will be
rejected and it will have to re-request consent.

## How it works (for operators)

Cairn implements a small, self-contained OAuth 2.1 **authorization server**:

| Step | Endpoint | RFC |
| --- | --- | --- |
| Unauthenticated probe | `POST /api/mcp` → `401 WWW-Authenticate: Bearer resource_metadata="…"` | MCP 2025-06 |
| Protected-resource metadata | `GET /.well-known/oauth-protected-resource` | RFC 9728 |
| Authorization-server metadata | `GET /.well-known/oauth-authorization-server` | RFC 8414 |
| Dynamic client registration | `POST /api/oauth/register` | RFC 7591 |
| Authorize + consent | `GET/POST /api/oauth/authorize` | RFC 6749 + PKCE |
| Token + refresh | `POST /api/oauth/token` | RFC 6749 |
| Revocation | `POST /api/oauth/revoke` | RFC 7009 |

Security properties:

- **PKCE S256 is mandatory** for every client (public and confidential). An
  authorization request without a valid `code_challenge` is rejected.
- **`redirect_uri` is exact-match** against the client's registered allowlist; a
  non-matching URI is rejected without redirecting to it.
- **All secrets are SHA-256 hashed at rest** (authorization codes, access tokens,
  refresh tokens, client secrets) — never stored or logged in plaintext.
- **Refresh tokens rotate**: each refresh revokes the presented token and issues a
  new one, so a captured refresh token is single-use.
- **Authorization codes are one-shot** and expire in 60 seconds; replaying a code
  revokes any tokens already issued from it.
- Every consent, token issuance, and revocation is **audited**
  (`oauth.consent_granted`, `oauth.token_issued`, `oauth.token_revoked`).

Access tokens (`cairn_oauth_…`) resolve through the **same enforcement path as
PATs**, so the `mcp:*` scope gate and all `requireScope` checks apply unchanged.

> **Reverse proxies:** the discovery metadata URLs are derived from the host the
> request reached (forwarded-host aware), so a bare `docker compose` deploy behind
> a proxy advertises the correct external origin without extra configuration. See
> `PUBLIC_URL` / `NEXTAUTH_URL` in [operations.md](./operations.md).

## Bearer-token setup (PATs)

Prefer a long-lived token (for scripts, CI, or a client that doesn't support
OAuth)? Mint a **personal access token** in **Settings → Developer → Personal
tokens** and paste it into your client config under
**"Use a bearer token instead"**:

```json
{
  "mcpServers": {
    "cairn": {
      "transport": "streamable-http",
      "url": "https://<your-host>/api/mcp",
      "headers": { "Authorization": "Bearer <paste-your-cairn_pat_-token>" }
    }
  }
}
```

Give the token at least one `mcp:*` scope (`mcp:read`, `mcp:write`, or
`mcp:destructive`) plus the resource scopes the tools need (e.g. `pages:read`).
PATs additionally support a per-tool allowlist; OAuth grants gate by scope alone.
