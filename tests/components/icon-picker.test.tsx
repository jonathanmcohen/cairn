// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IconPicker } from '@/components/icon-picker';

// vitest config does not enable `globals`, so @testing-library/react cannot
// auto-register its afterEach cleanup. Without it, repeated render() calls
// accumulate in document.body across tests.

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('IconPicker', () => {
  it('renders the current emoji on the trigger button', () => {
    render(<IconPicker value="emoji::🪨" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Change icon' }).textContent).toContain('🪨');
  });

  it('opens the popover and does NOT render a redundant React search input (#129)', () => {
    render(<IconPicker value={null} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change icon' }));
    // The emoji-picker-element web component provides its own internal search
    // box; the component must not render a second React <input> on top of it.
    expect(screen.queryByLabelText('Search emoji')).toBeNull();
    // The picker mount point is still present.
    expect(document.querySelector('[data-testid="emoji-picker-mount"]')).toBeTruthy();
  });

  it('writes recently-used to localStorage when an emoji is picked from the recently-used row', () => {
    // Pre-seed recent with a couple emoji so the row renders.
    window.localStorage.setItem('cairn:recent-emojis', JSON.stringify(['🪨', '📌']));
    const onChange = vi.fn();
    render(<IconPicker value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change icon' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use 📌' }));
    expect(onChange).toHaveBeenCalledWith('emoji::📌');
    // Picking 📌 moves it to the front of recents.
    const after = JSON.parse(window.localStorage.getItem('cairn:recent-emojis') ?? '[]');
    expect(after[0]).toBe('📌');
  });

  it('"Remove" clears the icon', () => {
    const onChange = vi.fn();
    render(<IconPicker value="emoji::🪨" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change icon' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('closes the picker on Escape (#131)', () => {
    render(<IconPicker value={null} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Change icon' }));
    // Popover open → the emoji mount point is in the DOM.
    expect(document.querySelector('[data-testid="emoji-picker-mount"]')).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
      code: 'Escape',
    });
    expect(document.querySelector('[data-testid="emoji-picker-mount"]')).toBeNull();
  });
});
