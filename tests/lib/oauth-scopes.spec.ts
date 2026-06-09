/**
 * Plan F (MCP OAuth) — OAuth scope presets + role-intersection validation.
 * See docs/superpowers/plans/v0.9.16/plan-F-mcp-oauth.md.
 */
import { describe, expect, it } from 'vitest';
import { OAUTH_PRESETS, scopesForRole, validateScopes } from '@/lib/oauth/scopes';

describe('OAUTH_PRESETS', () => {
  it('mcp:read mirrors the MCP read-only preset', () => {
    expect(OAUTH_PRESETS['mcp:read']).toEqual([
      'mcp:read',
      'pages:read',
      'databases:read',
      'comments:read',
      'files:read',
    ]);
  });

  it('mcp:write includes read + write across resources', () => {
    expect(OAUTH_PRESETS['mcp:write']).toEqual([
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
    ]);
  });

  it('admin preset contains the admin scope', () => {
    expect(OAUTH_PRESETS.admin).toContain('admin');
  });
});

describe('validateScopes', () => {
  it('drops scopes the role cannot grant (viewer cannot grant pages:write)', () => {
    const allowed = scopesForRole('viewer');
    const result = validateScopes(['pages:read', 'pages:write'], allowed);
    expect(result).toContain('pages:read');
    expect(result).not.toContain('pages:write');
  });

  it('an editor keeps write scopes but not admin', () => {
    const allowed = scopesForRole('editor');
    const result = validateScopes(['pages:write', 'admin'], allowed);
    expect(result).toContain('pages:write');
    expect(result).not.toContain('admin');
  });

  it('rejects unknown scope strings', () => {
    const allowed = scopesForRole('admin');
    const result = validateScopes(['pages:read', 'not-a-real-scope'], allowed);
    expect(result).toContain('pages:read');
    expect(result).not.toContain('not-a-real-scope');
  });

  it('mcp:* scopes pass through for an editor', () => {
    const allowed = scopesForRole('editor');
    const result = validateScopes(['mcp:read', 'mcp:write'], allowed);
    expect(result).toEqual(['mcp:read', 'mcp:write']);
  });

  it('admin role can grant the admin scope', () => {
    const allowed = scopesForRole('admin');
    expect(validateScopes(['admin'], allowed)).toContain('admin');
  });
});
