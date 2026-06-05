// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorColorPopover } from '@/components/editor/editor-color-popover';

afterEach(cleanup);

// Echo i18n keys as their accessible names.
vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));

function makeEditor() {
  const chain = {
    focus: () => chain,
    setColor: vi.fn(() => chain),
    unsetColor: vi.fn(() => chain),
    toggleHighlight: vi.fn(() => chain),
    setHighlight: vi.fn(() => chain),
    unsetHighlight: vi.fn(() => chain),
    run: vi.fn(() => true),
  };
  return {
    chain: () => chain,
    isActive: () => false,
    getAttributes: () => ({}),
    __chain: chain,
  } as never;
}

function chainOf(editor: unknown) {
  return (editor as { __chain: Record<string, ReturnType<typeof vi.fn>> }).__chain;
}

describe('<EditorColorPopover>', () => {
  it('renders a ≥44px trigger labelled by editor.bubble.color', () => {
    render(<EditorColorPopover editor={makeEditor()} />);
    const trigger = screen.getByRole('button', { name: 'editor.bubble.color' });
    expect(trigger.className).toContain('min-h-11');
    expect(trigger.className).toContain('min-w-11');
  });

  it('opening the popover reveals labelled text + highlight swatches and removes', () => {
    render(<EditorColorPopover editor={makeEditor()} />);
    fireEvent.click(screen.getByRole('button', { name: 'editor.bubble.color' }));
    // Color names are reused for both sections, so each appears twice (text + highlight).
    expect(screen.getAllByRole('button', { name: 'editor.color.swatch.red' }).length).toBe(2);
    expect(screen.getByRole('button', { name: 'editor.color.removeText' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'editor.color.removeHighlight' })).toBeTruthy();
  });

  it('every swatch button keeps the 44px touch floor', () => {
    render(<EditorColorPopover editor={makeEditor()} />);
    fireEvent.click(screen.getByRole('button', { name: 'editor.bubble.color' }));
    for (const btn of screen.getAllByRole('button', { name: 'editor.color.swatch.blue' })) {
      expect(btn.className).toContain('min-h-11');
      expect(btn.className).toContain('min-w-11');
    }
  });

  it('a text swatch calls setColor with that hex', () => {
    const editor = makeEditor();
    render(<EditorColorPopover editor={editor} />);
    fireEvent.click(screen.getByRole('button', { name: 'editor.bubble.color' }));
    const [textRed] = screen.getAllByRole('button', { name: 'editor.color.swatch.red' });
    fireEvent.click(textRed);
    expect(chainOf(editor).setColor).toHaveBeenCalledWith('#dc2626');
    expect(chainOf(editor).run).toHaveBeenCalled();
  });

  it('a highlight swatch calls setHighlight with that hex', () => {
    const editor = makeEditor();
    render(<EditorColorPopover editor={editor} />);
    fireEvent.click(screen.getByRole('button', { name: 'editor.bubble.color' }));
    const reds = screen.getAllByRole('button', { name: 'editor.color.swatch.red' });
    fireEvent.click(reds[1]); // second section = highlight
    expect(chainOf(editor).setHighlight).toHaveBeenCalledWith({ color: '#fecaca' });
  });

  it('Remove text color calls unsetColor; Remove highlight calls unsetHighlight', () => {
    const editor = makeEditor();
    render(<EditorColorPopover editor={editor} />);
    fireEvent.click(screen.getByRole('button', { name: 'editor.bubble.color' }));
    fireEvent.click(screen.getByRole('button', { name: 'editor.color.removeText' }));
    expect(chainOf(editor).unsetColor).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'editor.color.removeHighlight' }));
    expect(chainOf(editor).unsetHighlight).toHaveBeenCalled();
  });
});
