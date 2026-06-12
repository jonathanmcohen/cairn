// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SidebarResizeHandle } from '@/components/sidebar-resize-handle';

vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('<SidebarResizeHandle>', () => {
  it('is a keyboard-operable separator that persists width on arrow keys', () => {
    render(<SidebarResizeHandle storageKey="cairn:sidebar-width" />);
    const handle = screen.getByRole('separator', { name: /resize sidebar/i });
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(localStorage.getItem('cairn:sidebar-width')).toBeTruthy();
  });

  // C1 (v0.9.18) — the carry-forward: the mount effect applies the RUNTIME
  // default unconditionally when nothing is persisted, so it must be 240px
  // (15rem). At 256 it silently snapped the sidebar back on hydration,
  // overriding the 240px SSR fallback the v0.9.14 fix shipped.
  it('applies a 240px runtime default on mount when no width is persisted (C1)', () => {
    render(<SidebarResizeHandle storageKey="cairn:sidebar-width" />);
    expect(document.documentElement.style.getPropertyValue('--cairn-sidebar-w')).toBe('240px');
    const handle = screen.getByRole('separator', { name: /resize sidebar/i });
    expect(handle.getAttribute('aria-valuenow')).toBe('240');
  });

  it('runtime default stays in lockstep with the SSR fallback (15rem) in sidebar.tsx', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const sidebarSrc = readFileSync(resolve('src/components/sidebar.tsx'), 'utf8');
    // 15rem = 240px — if either side changes, both must move together.
    expect(sidebarSrc).toContain('var(--cairn-sidebar-w, 15rem)');
  });

  it('persisted width still wins over the default', () => {
    localStorage.setItem('cairn:sidebar-width', '320');
    render(<SidebarResizeHandle storageKey="cairn:sidebar-width" />);
    expect(document.documentElement.style.getPropertyValue('--cairn-sidebar-w')).toBe('320px');
  });

  // v0.10.2 S1 — bounds widened from [200, 480] to [56, 400]. MIN matches the
  // collapsed icon-rail width; DEFAULT stays 240 (pinned above + SSR fallback).
  it('pins MIN=56 / MAX=400 via the separator value range (S1)', () => {
    render(<SidebarResizeHandle storageKey="cairn:sidebar-width" />);
    const handle = screen.getByRole('separator', { name: /resize sidebar/i });
    expect(handle.getAttribute('aria-valuemin')).toBe('56');
    expect(handle.getAttribute('aria-valuemax')).toBe('400');
  });

  it('Home snaps to MIN (56) and End snaps to MAX (400), both persisted (S1)', () => {
    render(<SidebarResizeHandle storageKey="cairn:sidebar-width" />);
    const handle = screen.getByRole('separator', { name: /resize sidebar/i });
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(localStorage.getItem('cairn:sidebar-width')).toBe('56');
    expect(document.documentElement.style.getPropertyValue('--cairn-sidebar-w')).toBe('56px');
    fireEvent.keyDown(handle, { key: 'End' });
    expect(localStorage.getItem('cairn:sidebar-width')).toBe('400');
    expect(document.documentElement.style.getPropertyValue('--cairn-sidebar-w')).toBe('400px');
  });

  it('clamps persisted widths outside [56, 400] on mount (S1)', () => {
    localStorage.setItem('cairn:sidebar-width', '480');
    render(<SidebarResizeHandle storageKey="cairn:sidebar-width" />);
    expect(document.documentElement.style.getPropertyValue('--cairn-sidebar-w')).toBe('400px');
  });
});
