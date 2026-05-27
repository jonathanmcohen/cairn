// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ReadOnlyView } from '@/components/editor/read-only-view';

afterEach(() => {
  cleanup();
});

// v0.9.0 G3 P18 review fix — assert the public page renderer numbers and
// reveals footnote-marked spans via `<FootnoteSup>`. A bare `<sup>` with no
// number + no popover is the bug this test pins down.
const DOC = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Alpha' },
        {
          type: 'text',
          text: 'one',
          marks: [{ type: 'footnote', attrs: { id: 'fa', content: 'first note' } }],
        },
        { type: 'text', text: ' Beta ' },
        {
          type: 'text',
          text: 'two',
          marks: [{ type: 'footnote', attrs: { id: 'fb', content: 'second note' } }],
        },
      ],
    },
  ],
} as unknown as Parameters<typeof ReadOnlyView>[0]['content'];

describe('ReadOnlyView footnote hydration (public page)', () => {
  it('numbers footnote marks 1, 2 in document order via FootnoteSup', async () => {
    const { container } = render(<ReadOnlyView content={DOC} />);
    await waitFor(() => {
      const buttons = container.querySelectorAll<HTMLButtonElement>('button[role="doc-noteref"]');
      expect(buttons.length).toBe(2);
    });
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[role="doc-noteref"]'),
    );
    expect(buttons[0]?.textContent).toContain('1');
    expect(buttons[1]?.textContent).toContain('2');
    expect(buttons[0]?.getAttribute('aria-label')).toBe('Footnote 1');
    expect(buttons[1]?.getAttribute('aria-label')).toBe('Footnote 2');
  });

  it('reveals the footnote text in the DOM when toggled', async () => {
    const { container } = render(<ReadOnlyView content={DOC} />);
    await waitFor(() => {
      expect(container.querySelectorAll('button[role="doc-noteref"]').length).toBe(2);
    });
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[role="doc-noteref"]'),
    );
    if (!buttons[0] || !buttons[1]) throw new Error('expected two footnote buttons');
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    const notes = Array.from(container.querySelectorAll('[role="doc-footnote"]'));
    const text = notes.map((n) => n.textContent).join('|');
    expect(text).toContain('first note');
    expect(text).toContain('second note');
    // aria-describedby links each trigger to its revealed footnote panel.
    for (const b of buttons) {
      const describedBy = b.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      expect(container.querySelector(`#${describedBy}`)).toBeTruthy();
    }
  });
});
