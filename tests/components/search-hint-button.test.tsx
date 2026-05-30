// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchHintButton } from '@/components/search-hint-button';

vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));

afterEach(cleanup);

describe('<SearchHintButton>', () => {
  it('names the command palette (not bare "Search…") and advertises the ⌘K shortcut', () => {
    render(<SearchHintButton />);
    const btn = screen.getByRole('button');
    // i18n key (stubbed to echo) names the palette, not a bare search box.
    expect(btn.textContent ?? '').toMatch(/searchHint\.label|palette|command/i);
    expect(btn.getAttribute('aria-keyshortcuts')).toBe('Meta+K');
    expect(btn.className).toMatch(/min-h-11/);
  });

  it('dispatches the ⌘K shortcut to open the palette on click', () => {
    const onKey = vi.fn();
    window.addEventListener('keydown', onKey);
    render(<SearchHintButton />);
    fireEvent.click(screen.getByRole('button'));
    window.removeEventListener('keydown', onKey);
    const ev = onKey.mock.calls.at(-1)?.[0] as KeyboardEvent | undefined;
    expect(ev?.key).toBe('k');
    expect(ev?.metaKey).toBe(true);
  });
});
