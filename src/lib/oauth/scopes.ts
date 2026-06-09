import type { MemberRole } from '@/lib/auth/require-role';

/**
 * v0.9.16 Plan F — OAuth scope vocabulary. Reuses the PAT scope strings verbatim
 * (the 16 scopes from the Mint-Token dialog) — there are NO new scope strings.
 */
export const OAUTH_SCOPES = [
  'pages:read',
  'pages:write',
  'pages:destructive',
  'databases:read',
  'databases:write',
  'databases:destructive',
  'comments:read',
  'comments:write',
  'comments:destructive',
  'files:read',
  'files:write',
  'files:destructive',
  'mcp:read',
  'mcp:write',
  'mcp:destructive',
  'admin',
] as const;

export type OauthScope = (typeof OAUTH_SCOPES)[number];

const SCOPE_SET = new Set<string>(OAUTH_SCOPES);

/** True if `scope` is one of the 16 canonical scope strings. */
export function isKnownScope(scope: string): scope is OauthScope {
  return SCOPE_SET.has(scope);
}

/**
 * Named presets mirroring the MCP presets in the Mint-Token dialog. An OAuth
 * client requests one of these (or a raw scope list); the granted set is then
 * intersected with the consenting user's role at consent time.
 */
export const OAUTH_PRESETS: Record<'mcp:read' | 'mcp:write' | 'admin', OauthScope[]> = {
  'mcp:read': ['mcp:read', 'pages:read', 'databases:read', 'comments:read', 'files:read'],
  'mcp:write': [
    'mcp:read',
    'mcp:write',
    'pages:read',
    'pages:write',
    'databases:read',
    'databases:write',
    'comments:read',
    'comments:write',
    'files:read',
    'files:write',
  ],
  admin: [...OAUTH_SCOPES],
};

/**
 * The scopes a given workspace role may grant. Cumulative (admin ⊇ editor ⊇
 * viewer), and — unlike `ROLE_SCOPES` in token.ts which is api_key-only — this
 * includes the `mcp:*` scopes so an OAuth grant can carry MCP access:
 *   viewer → read scopes + mcp:read
 *   editor → + write scopes + mcp:write
 *   admin/owner → + destructive scopes + mcp:destructive + admin
 */
const ROLE_GRANTABLE: Record<MemberRole, OauthScope[]> = {
  viewer: ['pages:read', 'databases:read', 'comments:read', 'files:read', 'mcp:read'],
  editor: [
    'pages:read',
    'pages:write',
    'databases:read',
    'databases:write',
    'comments:read',
    'comments:write',
    'files:read',
    'files:write',
    'mcp:read',
    'mcp:write',
  ],
  admin: [...OAUTH_SCOPES],
  owner: [...OAUTH_SCOPES],
};

/** Scopes the role is permitted to grant to an OAuth client. */
export function scopesForRole(role: MemberRole): OauthScope[] {
  return ROLE_GRANTABLE[role];
}

/**
 * Intersect a requested scope list with what the role may grant, dropping
 * unknown scope strings AND scopes the role cannot grant. This is the
 * scope-at-consent intersection — a viewer requesting `pages:write` gets it
 * filtered out, never persisted. Order follows `requested`.
 */
export function validateScopes(requested: string[], allowedForRole: OauthScope[]): OauthScope[] {
  const allowed = new Set<string>(allowedForRole);
  const seen = new Set<string>();
  const out: OauthScope[] = [];
  for (const s of requested) {
    if (!isKnownScope(s)) continue;
    if (!allowed.has(s)) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * Resolve a requested `scope` param (space-delimited string or preset name) to a
 * concrete scope list. A bare preset name expands to its preset; otherwise each
 * space-separated token is treated as a raw scope. Unknown tokens are dropped by
 * `validateScopes` downstream.
 */
export function expandRequestedScopes(scopeParam: string | null | undefined): string[] {
  if (!scopeParam) return OAUTH_PRESETS['mcp:read'];
  const trimmed = scopeParam.trim();
  if (trimmed in OAUTH_PRESETS) {
    return OAUTH_PRESETS[trimmed as keyof typeof OAUTH_PRESETS];
  }
  return trimmed.split(/\s+/).filter(Boolean);
}
