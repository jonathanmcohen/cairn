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
});
