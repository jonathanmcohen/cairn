// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudyLink } from '@/components/sidebar/study-link';

vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});

afterEach(cleanup);

describe('StudyLink density (C-v2)', () => {
  it('renders with pointer-gated height (min-h-[28px] + pointer-coarse:min-h-11)', () => {
    render(<StudyLink />);
    const link = screen.getByRole('link');
    expect(link.className).toContain('min-h-[28px]');
    expect(link.className).toContain('pointer-coarse:min-h-11');
    // bare min-h-11 must not be present (would defeat the pointer gate)
    expect(link.className).not.toMatch(/(^|\s)min-h-11(\s|$)/);
  });

  it('uses the 13px density triplet, not text-sm', () => {
    render(<StudyLink />);
    const link = screen.getByRole('link');
    expect(link.className).toContain('text-[length:var(--cairn-sidebar-text)]');
    expect(link.className).toContain('leading-[var(--cairn-sidebar-leading)]');
    expect(link.className).toContain('tracking-[0.1px]');
    expect(link.className).not.toMatch(/(^|\s)text-sm(\s|$)/);
  });
});
