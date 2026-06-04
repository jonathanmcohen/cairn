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

function makeEditor(overrides: Record<string, unknown> = {}) {
  const chain = {
    focus: () => chain,
    toggleBold: () => chain,
    toggleItalic: () => chain,
    toggleStrike: () => chain,
    toggleCode: () => chain,
    toggleHeading: vi.fn(() => chain),
    setTextAlign: vi.fn(() => chain),
    toggleSubscript: vi.fn(() => chain),
    toggleSuperscript: vi.fn(() => chain),
    setColor: vi.fn(() => chain),
    unsetColor: vi.fn(() => chain),
    toggleHighlight: vi.fn(() => chain),
    unsetHighlight: vi.fn(() => chain),
    insertContent: vi.fn(() => chain),
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
    __chain: chain,
    ...overrides,
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

  it('exposes the expanded #275 controls by accessible name', () => {
    render(<EditorBubbleMenu editor={makeEditor()} />);
    for (const name of [
      'editor.bubble.color',
      'editor.bubble.highlight',
      'editor.bubble.h1',
      'editor.bubble.h2',
      'editor.bubble.h3',
      'editor.bubble.comment',
      'editor.bubble.alignLeft',
      'editor.bubble.alignCenter',
      'editor.bubble.alignRight',
      'editor.bubble.subscript',
      'editor.bubble.superscript',
      'editor.bubble.inlineMath',
    ]) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });

  it('Heading 1 toggles a level-1 heading', () => {
    const editor = makeEditor();
    render(<EditorBubbleMenu editor={editor} />);
    fireEvent.click(screen.getByRole('button', { name: 'editor.bubble.h1' }));
    expect(
      (editor as unknown as { __chain: { toggleHeading: ReturnType<typeof vi.fn> } }).__chain
        .toggleHeading,
    ).toHaveBeenCalledWith({ level: 1 });
  });

  it('Comment dispatches the cairn:editor:comment-selection event', () => {
    const listener = vi.fn();
    window.addEventListener('cairn:editor:comment-selection', listener);
    render(<EditorBubbleMenu editor={makeEditor()} />);
    fireEvent.click(screen.getByRole('button', { name: 'editor.bubble.comment' }));
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener('cairn:editor:comment-selection', listener);
  });

  it('Inline math inserts an empty math node', () => {
    const editor = makeEditor();
    render(<EditorBubbleMenu editor={editor} />);
    fireEvent.click(screen.getByRole('button', { name: 'editor.bubble.inlineMath' }));
    expect(
      (editor as unknown as { __chain: { insertContent: ReturnType<typeof vi.fn> } }).__chain
        .insertContent,
    ).toHaveBeenCalledWith({ type: 'math', attrs: { latex: '', display: false } });
  });
});
