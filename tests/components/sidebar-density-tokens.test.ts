import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

describe('sidebar density tokens (#130)', () => {
  it('defines the sidebar body text-size token at 13px', () => {
    expect(css).toMatch(/--cairn-sidebar-text:\s*13px/);
  });
  it('defines the sidebar line-height token at 18px', () => {
    expect(css).toMatch(/--cairn-sidebar-leading:\s*18px/);
  });
});

describe('sidebar tree row height (C-v3 optional)', () => {
  it('ROW_HEIGHT_PX is 26 (denser tree)', async () => {
    // v0.10.0 H3 — the contract moved to the dependency-free density-tokens
    // module (so the runtime-px e2e can import it); assert the VALUE, not a
    // source regex.
    const { ROW_HEIGHT_PX } = await import('@/components/sidebar/density-tokens');
    expect(ROW_HEIGHT_PX).toBe(26);
  });
});

describe('sidebar padding tokens (C-v3 optional)', () => {
  it('defines --cairn-sidebar-px token', () => {
    expect(css).toMatch(/--cairn-sidebar-px:\s*6px/);
  });
  it('defines --cairn-sidebar-section-gap token', () => {
    expect(css).toMatch(/--cairn-sidebar-section-gap:\s*6px/);
  });
});

describe('sidebar density preference (v0.10.2 S2)', () => {
  it('pins the per-density row-height contract: comfortable 26 / compact 22', async () => {
    const { ROW_HEIGHT_BY_DENSITY, ROW_HEIGHT_PX } = await import(
      '@/components/sidebar/density-tokens'
    );
    expect(ROW_HEIGHT_BY_DENSITY).toEqual({ comfortable: 26, compact: 22 });
    // The legacy export stays the comfortable baseline so pre-S2 imports
    // (including the H3 e2e) keep meaning "default density".
    expect(ROW_HEIGHT_PX).toBe(ROW_HEIGHT_BY_DENSITY.comfortable);
  });

  it('pins the persistence/event/root-class identifiers the e2e relies on', async () => {
    const tokens = await import('@/components/sidebar/density-tokens');
    expect(tokens.SIDEBAR_DENSITY_STORAGE_KEY).toBe('cairn:sidebar-density');
    expect(tokens.SIDEBAR_DENSITY_EVENT).toBe('cairn:density-changed');
    expect(tokens.SIDEBAR_DENSITY_COMPACT_CLASS).toBe('cairn-sidebar-compact');
  });

  it('globals.css overrides the font tokens to 12px/16px under html.cairn-sidebar-compact', () => {
    // jsdom cannot exercise the cascade; pin that the override rule exists and
    // is well-formed (the controller's e2e measures rendered px).
    const rule = css.match(/html\.cairn-sidebar-compact\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule?.[0]).toMatch(/--cairn-sidebar-text:\s*12px/);
    expect(rule?.[0]).toMatch(/--cairn-sidebar-leading:\s*16px/);
  });

  it('getSidebarDensity defaults to comfortable when nothing is persisted', async () => {
    // This file runs in the node environment (no jsdom): localStorage is
    // either absent (the SSR case) or empty — both must yield the default.
    const { getSidebarDensity } = await import('@/components/sidebar/density-tokens');
    expect(getSidebarDensity()).toBe('comfortable');
  });
});
