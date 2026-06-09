import { asc, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { auth } from '@/lib/auth/config';
import type { MemberRole } from '@/lib/auth/require-role';
import { loadClientByClientId } from '@/lib/oauth/clients';
import { issueAuthCode } from '@/lib/oauth/codes';
import { scopeLabel } from '@/lib/oauth/scope-labels';
import { expandRequestedScopes, scopesForRole, validateScopes } from '@/lib/oauth/scopes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ValidatedRequest = {
  client: schema.OauthClient;
  redirectUri: string;
  scopeParam: string | null;
  state: string | null;
  codeChallenge: string;
};

type ValidationError = {
  status: number;
  /** When set, the error may be reported via the redirect_uri (it was validated). */
  redirectable: boolean;
  error: string;
  description: string;
  redirectUri?: string;
  state?: string | null;
};

/**
 * Validate the common /authorize params. SECURITY: redirect_uri is exact-match
 * against the client's allowlist BEFORE anything is redirected to it — a
 * non-matching URI is a hard 400 that does NOT redirect (open-redirect guard).
 * PKCE S256 is REQUIRED: a missing code_challenge or a method other than S256 is
 * `invalid_request`.
 */
async function validate(params: URLSearchParams): Promise<ValidatedRequest | ValidationError> {
  const clientId = params.get('client_id');
  const redirectUri = params.get('redirect_uri');
  const responseType = params.get('response_type');
  const codeChallenge = params.get('code_challenge');
  const method = params.get('code_challenge_method');
  const state = params.get('state');
  const scopeParam = params.get('scope');

  if (!clientId) {
    return {
      status: 400,
      redirectable: false,
      error: 'invalid_request',
      description: 'missing client_id',
    };
  }
  const client = await loadClientByClientId(getDb(), clientId);
  if (!client) {
    return {
      status: 400,
      redirectable: false,
      error: 'invalid_client',
      description: 'unknown client_id',
    };
  }

  // Exact-match redirect_uri BEFORE any redirect-based error reporting.
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
    return {
      status: 400,
      redirectable: false,
      error: 'invalid_redirect_uri',
      description: 'redirect_uri is not in the client allowlist',
    };
  }

  // From here, errors MAY be reported to the (validated) redirect_uri.
  if (responseType !== 'code') {
    return {
      status: 400,
      redirectable: true,
      error: 'unsupported_response_type',
      description: 'only response_type=code is supported',
      redirectUri,
      state,
    };
  }
  if (!codeChallenge) {
    return {
      status: 400,
      redirectable: true,
      error: 'invalid_request',
      description: 'code_challenge is required (PKCE)',
      redirectUri,
      state,
    };
  }
  if (method !== 'S256') {
    return {
      status: 400,
      redirectable: true,
      error: 'invalid_request',
      description: 'code_challenge_method must be S256',
      redirectUri,
      state,
    };
  }

  return { client, redirectUri, scopeParam, state, codeChallenge };
}

function errorResponse(err: ValidationError): Response {
  // A hard (non-redirectable) error returns JSON; we never redirect to an
  // unvalidated URI. (Redirectable param errors could 302 to redirect_uri, but
  // a JSON 400 is also spec-compliant and safer for tests/clients.)
  return Response.json(
    { error: err.error, error_description: err.description },
    { status: err.status },
  );
}

/** Resolve the signed-in user's active workspace + role (cookie-free, for the AS). */
async function resolveActiveMembership(
  userId: string,
): Promise<{ workspaceId: string; workspaceName: string; role: MemberRole } | null> {
  const rows = await getDb()
    .select({
      workspaceId: schema.workspaceMembers.workspaceId,
      role: schema.workspaceMembers.role,
      workspaceName: schema.workspaces.name,
    })
    .from(schema.workspaceMembers)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceMembers.workspaceId))
    .where(eq(schema.workspaceMembers.userId, userId))
    .orderBy(asc(schema.workspaceMembers.joinedAt))
    .limit(1);
  const m = rows[0];
  if (!m) return null;
  return { workspaceId: m.workspaceId, workspaceName: m.workspaceName, role: m.role };
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Server-rendered, themed consent screen (no token paste). */
function renderConsent(opts: {
  clientName: string;
  workspaceName: string;
  scopes: string[];
  hidden: Record<string, string>;
}): Response {
  const hiddenInputs = Object.entries(opts.hidden)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}" />`)
    .join('');
  const scopeItems = opts.scopes
    .map((s) => `<li class="oauth-scope" data-scope="${esc(s)}">${esc(scopeLabel(s))}</li>`)
    .join('');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Authorize ${esc(opts.clientName)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; background: #f6f6f7; color: #111; margin: 0; display: grid; place-items: center; min-height: 100vh; }
  .card { background: #fff; border: 1px solid #e3e3e6; border-radius: 12px; max-width: 28rem; width: calc(100% - 2rem); padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
  h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
  .muted { color: #555; font-size: .9rem; }
  ul { list-style: none; padding: 0; margin: 1rem 0; }
  .oauth-scope { padding: .4rem .6rem; border-radius: 8px; background: #f0f0f2; margin-bottom: .35rem; font-size: .9rem; }
  .actions { display: flex; gap: .75rem; margin-top: 1.25rem; }
  button { flex: 1; min-height: 44px; border-radius: 8px; border: 1px solid #d0d0d4; font-size: 1rem; cursor: pointer; }
  button.allow { background: #111; color: #fff; border-color: #111; }
  button.cancel { background: #fff; color: #111; }
  @media (prefers-color-scheme: dark) {
    body { background: #0c0c0d; color: #f2f2f2; }
    .card { background: #161617; border-color: #2a2a2c; }
    .muted { color: #aaa; }
    .oauth-scope { background: #202022; }
    button.cancel { background: #161617; color: #f2f2f2; border-color: #2a2a2c; }
    button.allow { background: #f2f2f2; color: #111; border-color: #f2f2f2; }
  }
</style>
</head>
<body>
  <main class="card">
    <h1>Connect <span class="client-name">${esc(opts.clientName)}</span>?</h1>
    <p class="muted"><span class="client-name">${esc(opts.clientName)}</span> wants to connect to your <strong class="workspace-name">${esc(opts.workspaceName)}</strong> workspace and will be able to:</p>
    <ul>${scopeItems}</ul>
    <form method="post" action="/api/oauth/authorize">
      ${hiddenInputs}
      <div class="actions">
        <button class="cancel" type="submit" name="decision" value="deny">Cancel</button>
        <button class="allow" type="submit" name="decision" value="allow">Allow</button>
      </div>
    </form>
  </main>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const validated = await validate(url.searchParams);
  if ('error' in validated) return errorResponse(validated);

  const session = await auth();
  if (!session?.user?.id) {
    // Bounce through login, returning to this exact authorize URL afterwards.
    const returnTo = `${url.pathname}${url.search}`;
    const loginUrl = `/login?returnTo=${encodeURIComponent(returnTo)}`;
    return Response.redirect(new URL(loginUrl, url.origin), 302);
  }

  const membership = await resolveActiveMembership(session.user.id);
  if (!membership) {
    return Response.json(
      { error: 'access_denied', error_description: 'no workspace membership' },
      { status: 403 },
    );
  }

  const requested = expandRequestedScopes(validated.scopeParam);
  const granted = validateScopes(requested, scopesForRole(membership.role));

  return renderConsent({
    clientName: validated.client.clientName,
    workspaceName: membership.workspaceName,
    scopes: granted,
    hidden: {
      client_id: validated.client.clientId,
      redirect_uri: validated.redirectUri,
      response_type: 'code',
      code_challenge: validated.codeChallenge,
      code_challenge_method: 'S256',
      scope: validated.scopeParam ?? '',
      state: validated.state ?? '',
    },
  });
}

export async function POST(req: Request): Promise<Response> {
  const form = await req.formData();
  const params = new URLSearchParams();
  for (const [k, v] of form.entries()) {
    if (typeof v === 'string') params.set(k, v);
  }

  const validated = await validate(params);
  if ('error' in validated) return errorResponse(validated);

  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: 'access_denied' }, { status: 401 });
  }
  const membership = await resolveActiveMembership(session.user.id);
  if (!membership) {
    return Response.json({ error: 'access_denied' }, { status: 403 });
  }

  const decision = params.get('decision');
  const state = validated.state;

  if (decision !== 'allow') {
    // Cancel → access_denied to the client redirect_uri.
    const u = new URL(validated.redirectUri);
    u.searchParams.set('error', 'access_denied');
    if (state) u.searchParams.set('state', state);
    return Response.redirect(u, 302);
  }

  const requested = expandRequestedScopes(validated.scopeParam);
  const granted = validateScopes(requested, scopesForRole(membership.role));

  const { code } = await issueAuthCode(getDb(), {
    clientId: validated.client.clientId,
    clientName: validated.client.clientName,
    userId: session.user.id,
    workspaceId: membership.workspaceId,
    scopes: granted,
    redirectUri: validated.redirectUri,
    codeChallenge: validated.codeChallenge,
  });

  const u = new URL(validated.redirectUri);
  u.searchParams.set('code', code);
  if (state) u.searchParams.set('state', state);
  return Response.redirect(u, 302);
}
