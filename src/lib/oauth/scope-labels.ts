/**
 * v0.9.16 Plan F — friendly scope labels shared by the system consent HTML
 * (`/api/oauth/authorize` GET) and the themed in-app consent component. These
 * mirror the wording of the Mint-Token dialog's `devTokens.scope.<scope>.tip`
 * i18n keys (the React surface uses the i18n keys directly; this map is the
 * no-i18n fallback for the server-rendered authorize page).
 */
export const SCOPE_LABELS: Record<string, string> = {
  'pages:read': 'Read pages',
  'pages:write': 'Create and edit pages',
  'pages:destructive': 'Delete pages',
  'databases:read': 'Read databases',
  'databases:write': 'Create and edit databases',
  'databases:destructive': 'Delete databases',
  'comments:read': 'Read comments',
  'comments:write': 'Write comments',
  'comments:destructive': 'Delete comments',
  'files:read': 'Read files',
  'files:write': 'Upload files',
  'files:destructive': 'Delete files',
  'mcp:read': 'Use read-only MCP tools',
  'mcp:write': 'Use read/write MCP tools',
  'mcp:destructive': 'Use destructive MCP tools',
  admin: 'Full administrative access',
};

export function scopeLabel(scope: string): string {
  return SCOPE_LABELS[scope] ?? scope;
}
