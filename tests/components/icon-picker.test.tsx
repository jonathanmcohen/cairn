// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IconPicker } from '@/components/icon-picker';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../messages/en.json';

// vitest config does not enable `globals`, so @testing-library/react cannot
// auto-register its afterEach cleanup. Without it, repeated render() calls
// accumulate in document.body across tests.

function wrap(ui: React.ReactNode) {
  return render(
    <I18nProvider locale="en" messages={enMessages}>
      {ui}
    </I18nProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('IconPicker', () => {
  it('renders the current emoji on the trigger button', () => {
    wrap(<IconPicker value="emoji::🪨" onChange={() => {}} />);
    expect(
      screen.getByRole('button', { name: enMessages['iconPicker.changeAria'] }).textContent,
    ).toContain('🪨');
  });

  it('opens the popover and does NOT render a redundant React search input (#129)', () => {
    wrap(<IconPicker value={null} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: enMessages['iconPicker.changeAria'] }));
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
    wrap(<IconPicker value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: enMessages['iconPicker.changeAria'] }));
    fireEvent.click(screen.getByRole('button', { name: 'Use 📌' }));
    expect(onChange).toHaveBeenCalledWith('emoji::📌');
    // Picking 📌 moves it to the front of recents.
    const after = JSON.parse(window.localStorage.getItem('cairn:recent-emojis') ?? '[]');
    expect(after[0]).toBe('📌');
  });

  it('"Remove" clears the icon', () => {
    const onChange = vi.fn();
    wrap(<IconPicker value="emoji::🪨" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: enMessages['iconPicker.changeAria'] }));
    fireEvent.click(screen.getByRole('button', { name: enMessages['iconPicker.remove'] }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('closes the picker on Escape (#131)', () => {
    wrap(<IconPicker value={null} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: enMessages['iconPicker.changeAria'] }));
    // Popover open → the emoji mount point is in the DOM.
    expect(document.querySelector('[data-testid="emoji-picker-mount"]')).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
      code: 'Escape',
    });
    expect(document.querySelector('[data-testid="emoji-picker-mount"]')).toBeNull();
  });

  it('gives each category control a hover tooltip + accessible name (#231)', () => {
    wrap(<IconPicker value={null} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: enMessages['iconPicker.changeAria'] }));
    const emoji = screen.getByRole('button', { name: enMessages['iconPicker.emoji'] });
    const upload = screen.getByRole('button', { name: enMessages['iconPicker.upload'] });
    const remove = screen.getByRole('button', { name: enMessages['iconPicker.remove'] });
    expect(emoji.getAttribute('title')).toBe(enMessages['iconPicker.emojiTooltip']);
    expect(upload.getAttribute('title')).toBe(enMessages['iconPicker.uploadTooltip']);
    expect(remove.getAttribute('title')).toBe(enMessages['iconPicker.removeTooltip']);
  });
});
