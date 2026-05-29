// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorBubbleMenu } from '@/components/editor/editor-bubble-menu';

afterEach(cleanup);

// Mock @tiptap/react/menus BubbleMenu to just render its children (we test the
// toolbar contents + handlers, not floating-ui positioning).
vi.mock('@tiptap/react/menus', () => ({
  BubbleMenu: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bubble">{children}</div>
  ),
}));
// Mock the i18n provider so labels resolve to keys.
vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));

function makeEditor() {
  const chain = {
    focus: () => chain,
    toggleBold: () => chain,
    toggleItalic: () => chain,
    toggleStrike: () => chain,
    toggleCode: () => chain,
    unsetAllMarks: () => chain,
    setLink: () => chain,
    unsetLink: () => chain,
    extendMarkRange: () => chain,
    run: () => true,
  };
  return {
    chain: () => chain,
    isActive: () => false,
    getAttributes: () => ({}),
    state: { selection: { empty: false } },
  } as never;
}

describe('<EditorBubbleMenu>', () => {
  it('renders the formatting toolbar with accessible, ≥44px buttons', () => {
    render(<EditorBubbleMenu editor={makeEditor()} />);
    const bold = screen.getByRole('button', { name: 'editor.bubble.bold' });
    expect(bold).toBeTruthy();
    expect(bold.className).toContain('min-h-11');
    expect(bold.className).toContain('min-w-11');
    expect(screen.getByRole('button', { name: 'editor.bubble.italic' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'editor.bubble.strike' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'editor.bubble.code' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'editor.bubble.clear' })).toBeTruthy();
  });

  it('reveals the link input when the link button is pressed', () => {
    render(<EditorBubbleMenu editor={makeEditor()} />);
    fireEvent.click(screen.getByRole('button', { name: 'editor.bubble.link' }));
    expect(screen.getByPlaceholderText('editor.link.placeholder')).toBeTruthy();
  });
});
