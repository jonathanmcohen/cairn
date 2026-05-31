// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchHintButton } from '@/components/search-hint-button';

// The component reads strings via useT(); render with the authoritative English
// copy instead of wiring a full <I18nProvider> tree into the test.
vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});

afterEach(cleanup);

describe('<SearchHintButton>', () => {
  it('names the command palette via aria and advertises the ⌘K shortcut', () => {
    render(<SearchHintButton />);
    const btn = screen.getByRole('button');
    // The accessible name still names the palette (untouched by the label trim).
    expect(btn.getAttribute('aria-label')).toMatch(/command palette/i);
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

  it('labels the button without the redundant "(command palette)" subtitle', () => {
    render(<SearchHintButton />);
    const button = screen.getByRole('button', { name: 'Open command palette' });
    // The ⌘K badge already signals the palette — the visible label must not
    // carry the sub-12px parenthetical the audit flagged.
    expect(button.textContent ?? '').not.toMatch(/command palette/i);
    // …but the human-facing label text is still present.
    expect(button.textContent ?? '').toMatch(/Search or jump to/i);
  });

  it('still renders the ⌘K keyboard-shortcut badge', () => {
    render(<SearchHintButton />);
    expect(screen.getByText('⌘K')).toBeTruthy();
  });
});
