/**
 * Canonical list of MCP tool ids exposed by the Cairn MCP server.
 *
 * P6 will own the runtime tool registry; this module provides the static list
 * the dev-settings mint dialog renders for the per-PAT MCP-tool allowlist.
 * When P6 ships, the registry should import this list (or supersede it with a
 * single source of truth derived from registered handlers).
 */
export const MCP_TOOL_IDS = [
  'pages.list',
  'pages.read',
  'pages.create',
  'pages.update',
  'pages.delete',
  'pages.move',
  'databases.list',
  'databases.read',
  'databases.create_row',
  'databases.update_row',
  'databases.delete_row',
  'rows.list',
  'rows.update_cells',
  'search.fts',
  'comments.list',
  'comments.create',
  'files.list',
  'files.read_signed_url',
  'workspaces.info',
] as const;

export type McpToolId = (typeof MCP_TOOL_IDS)[number];
