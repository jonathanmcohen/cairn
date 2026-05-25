import { describe, expect, it } from 'vitest';
import { registry, type ToolDescriptor } from '@/lib/mcp/tools';

const EXPECTED_TOOL_IDS = [
  'pages.list',
  'pages.read',
  'pages.create',
  'pages.update',
  'pages.delete',
  'pages.move',
  'pages.export',
  'databases.list',
  'databases.read',
  'databases.create_row',
  'databases.update_row',
  'databases.delete_row',
  'rows.list',
  'rows.update_cells',
  'search.fts',
  'search.semantic',
  'comments.list',
  'comments.create',
  'files.list',
  'files.read_signed_url',
  'workspaces.info',
] as const;

const VALID_SCOPES = new Set([
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
]);

describe('MCP tool registry', () => {
  it('contains exactly the initial v0.7.0 tool set (search.semantic added in P13)', () => {
    const ids = registry.map((t) => t.id).sort();
    expect(ids).toEqual([...EXPECTED_TOOL_IDS].sort());
    expect(ids).toContain('search.semantic'); // added by P13
  });

  it('every descriptor has the required shape', () => {
    for (const t of registry) {
      expect(typeof t.id).toBe('string');
      expect(typeof t.description).toBe('string');
      expect(t.description.length).toBeGreaterThan(0);
      expect(VALID_SCOPES.has(t.scope)).toBe(true);
      expect(typeof t.destructive).toBe('boolean');
      // Zod schema sanity — every descriptor's inputSchema must be parsable.
      expect(typeof t.inputSchema.parse).toBe('function');
      expect(typeof t.handler).toBe('function');
    }
  });

  it('destructive tools declare a destructive scope', () => {
    const destructive = registry.filter((t) => t.destructive);
    expect(destructive.length).toBeGreaterThan(0);
    for (const t of destructive) {
      expect(t.scope.endsWith(':destructive')).toBe(true);
    }
  });

  it('tool ids are unique', () => {
    const ids = registry.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('exports a typed map for O(1) lookup', async () => {
    const { toolMap } = await import('@/lib/mcp/tools');
    for (const t of registry) {
      expect(toolMap.get(t.id)?.id).toBe(t.id);
    }
    expect(toolMap.get('unknown.tool')).toBeUndefined();
  });

  it('type ToolDescriptor is exported for transports to import', () => {
    // Compile-time check: this file imports ToolDescriptor. If the export
    // changes shape, this test file fails to compile. Runtime no-op.
    const _typeProbe: ToolDescriptor | undefined = registry[0];
    expect(_typeProbe).toBeDefined();
  });
});
