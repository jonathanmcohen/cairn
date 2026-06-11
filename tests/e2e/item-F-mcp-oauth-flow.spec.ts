// v0.9.19 F1 — full-flow RUNTIME verification of the MCP OAuth 2.1 loop
// (v0.9.16 Plan F). Every piece had unit/integration specs that import the
// route handlers directly — bypassing the edge proxy. This spec drives the real
// booted app THROUGH the proxy, acting as a headless MCP client (cookieless
// `request`) for the machine-to-machine steps and a logged-in browser for the
// consent screen. That layer is exactly where "implemented + unit-tested" broke
// live: the proxy redirected cookieless /.well-known, /api/oauth and /api/mcp
// requests to /login, so no real OAuth/MCP client could reach them.
//
// Requires `pnpm test:e2e` (built standalone app on :3200 + the proxy).
import { createHash, randomBytes } from 'node:crypto';
import { expect, signIn, test } from '../a11y/fixtures';

function pkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

test.describe('item F — MCP OAuth 2.1 full flow (runtime, through the proxy)', () => {
  test('discovery → register → consent → token → MCP call → rotation → revoke', async ({
    page,
    request,
    seeded,
  }) => {
    await signIn(page, seeded);
    // Land the browser so we can read the real origin it talks to; the OAuth
    // redirect_uri must be an absolute, same-origin URL the page can navigate to.
    await page.goto('/');
    const origin = new URL(page.url()).origin;
    const stamp = Date.now().toString(36);
    const cb = `${origin}/__f1_oauth_cb__${stamp}`;

    // 1. Discovery (RFC 8414 + RFC 9728) — UNAUTHENTICATED. The cookieless
    //    `request` context proves the proxy lets these through (the live bug
    //    redirected them to /login).
    const asRes = await request.get('/.well-known/oauth-authorization-server');
    expect(asRes.ok(), 'AS metadata reachable without a session').toBe(true);
    const as = await asRes.json();
    expect(as.issuer).toBeTruthy();
    expect(as.authorization_endpoint).toMatch(/\/api\/oauth\/authorize$/);
    expect(as.token_endpoint).toMatch(/\/api\/oauth\/token$/);
    expect(as.registration_endpoint).toMatch(/\/api\/oauth\/register$/);
    expect(as.revocation_endpoint).toMatch(/\/api\/oauth\/revoke$/);
    expect(as.code_challenge_methods_supported).toContain('S256');
    expect(as.response_types_supported).toContain('code');
    expect(as.scopes_supported).toEqual(expect.arrayContaining(['mcp:read', 'pages:read']));

    const prRes = await request.get('/.well-known/oauth-protected-resource');
    expect(prRes.ok(), 'protected-resource metadata reachable').toBe(true);
    const pr = await prRes.json();
    expect(pr.resource).toMatch(/\/api\/mcp$/);
    expect(pr.authorization_servers).toContain(as.issuer);

    // 2. Dynamic registration (RFC 7591) — public PKCE client, no secret.
    const regRes = await request.post('/api/oauth/register', {
      data: { client_name: `F1 MCP client ${stamp}`, redirect_uris: [cb] },
    });
    expect(regRes.status(), 'registration 201').toBe(201);
    const reg = await regRes.json();
    expect(reg.client_id).toBeTruthy();
    expect(reg.redirect_uris).toContain(cb);
    expect(reg.token_endpoint_auth_method).toBe('none');
    expect(reg.client_secret, 'public client has no secret').toBeUndefined();
    const clientId = reg.client_id as string;

    // 3. Authorize + consent in the logged-in browser → capture the code.
    const scope = 'mcp:read pages:read';
    const getAuthCode = async (challenge: string, state: string) => {
      const qs = new URLSearchParams({
        client_id: clientId,
        redirect_uri: cb,
        response_type: 'code',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        scope,
        state,
      });
      await page.goto(`/api/oauth/authorize?${qs.toString()}`);
      const allow = page.locator('button.allow');
      await expect(allow).toBeVisible({ timeout: 15_000 });
      await Promise.all([
        page.waitForURL((u) => u.toString().startsWith(cb), { timeout: 15_000 }),
        allow.click(),
      ]);
      const url = new URL(page.url());
      expect(url.searchParams.get('state'), 'state echoed').toBe(state);
      const code = url.searchParams.get('code');
      expect(code, 'authorization code present in redirect').toBeTruthy();
      return code as string;
    };

    const happy = pkcePair();
    const code = await getAuthCode(happy.challenge, `s-${stamp}`);

    // 4. Token exchange (authorization_code + PKCE verifier) → access + refresh.
    const tokRes = await request.post('/api/oauth/token', {
      form: {
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        redirect_uri: cb,
        code_verifier: happy.verifier,
      },
    });
    expect(tokRes.ok(), 'token exchange 200').toBe(true);
    const tok = await tokRes.json();
    expect(tok.access_token).toMatch(/^cairn_oauth_/);
    expect(tok.refresh_token).toMatch(/^cairn_oart_/);
    expect(tok.token_type).toBe('Bearer');
    expect(tok.expires_in).toBe(3600);
    expect(tok.scope.split(' ')).toEqual(expect.arrayContaining(['mcp:read', 'pages:read']));

    const mcpCall = (token: string | null, id: number, method: string) =>
      request.post('/api/mcp', {
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          'content-type': 'application/json',
        },
        data: { jsonrpc: '2.0', id, method },
      });

    // 5. MCP call WITH the access token → 200 + tool list (scope-filtered).
    const mcpOk = await mcpCall(tok.access_token, 1, 'tools/list');
    expect(mcpOk.ok(), 'authed MCP tools/list 200').toBe(true);
    const mcp = await mcpOk.json();
    const toolNames = (mcp.result.tools as { name: string }[]).map((t) => t.name);
    expect(toolNames).toContain('pages.read');

    // 5b. MCP call WITHOUT a token → 401 + the WWW-Authenticate challenge that
    //     points clients at the protected-resource metadata.
    const mcpAnon = await mcpCall(null, 2, 'tools/list');
    expect(mcpAnon.status(), 'unauthenticated MCP → 401').toBe(401);
    expect(mcpAnon.headers()['www-authenticate']).toContain(
      '/.well-known/oauth-protected-resource',
    );

    // 6. Refresh rotation: a new pair is issued, the OLD access+refresh row is
    //    revoked (old access token now 401), and reusing the old refresh fails.
    const refreshRes = await request.post('/api/oauth/token', {
      form: { grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: clientId },
    });
    expect(refreshRes.ok(), 'refresh 200').toBe(true);
    const tok2 = await refreshRes.json();
    expect(tok2.access_token).toMatch(/^cairn_oauth_/);
    expect(tok2.refresh_token).not.toBe(tok.refresh_token);

    const oldAccessAfterRotate = await mcpCall(tok.access_token, 3, 'tools/list');
    expect(oldAccessAfterRotate.status(), 'rotation revokes the old access token').toBe(401);

    // The rotated pair works BEFORE any reuse — order matters: since v0.10.0
    // G3, replaying a rotated refresh token revokes the ENTIRE token family
    // (descendants included), so this assert must precede the replay below.
    const newAccessWorks = await mcpCall(tok2.access_token, 4, 'tools/list');
    expect(newAccessWorks.ok(), 'rotated access token works').toBe(true);

    const reuseOldRefresh = await request.post('/api/oauth/token', {
      form: { grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: clientId },
    });
    expect(reuseOldRefresh.status(), 'reused refresh token → 400').toBe(400);
    expect((await reuseOldRefresh.json()).error).toBe('invalid_grant');

    // G3 contract: the reuse above burned the whole family — tok2 is dead too.
    const afterReuse = await mcpCall(tok2.access_token, 5, 'tools/list');
    expect(afterReuse.status(), 'refresh reuse revokes the rotated descendant').toBe(401);

    // 7. Revoke (RFC 7009) — silent 200 even for the already-revoked token,
    // and the MCP call stays 401.
    const revokeRes = await request.post('/api/oauth/revoke', {
      form: { token: tok2.access_token },
    });
    expect(revokeRes.status(), 'revoke 200').toBe(200);
    const afterRevoke = await mcpCall(tok2.access_token, 6, 'tools/list');
    expect(afterRevoke.status(), 'revoked token → 401').toBe(401);

    // 8. Negative: wrong PKCE verifier on a fresh code → 400 invalid_grant.
    const second = pkcePair();
    const code2 = await getAuthCode(second.challenge, `s2-${stamp}`);
    const wrong = pkcePair(); // a different, non-matching verifier
    const badExchange = await request.post('/api/oauth/token', {
      form: {
        grant_type: 'authorization_code',
        client_id: clientId,
        code: code2,
        redirect_uri: cb,
        code_verifier: wrong.verifier,
      },
    });
    expect(badExchange.status(), 'wrong PKCE verifier → 400').toBe(400);
    expect((await badExchange.json()).error).toBe('invalid_grant');
  });
});
