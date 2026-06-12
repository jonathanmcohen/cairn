// @vitest-environment jsdom
// v0.10.2 P5 — citation superscript chip + attrs-only hover/focus popover.
// The node view renders `[n]` (n = bibliography order) instead of the full
// formatted string inline; the popover shows author+year, title, and the
// formatted entry, all read from persisted node attrs (no fetch).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EditorContent, useEditor } from '@tiptap/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { baseExtensions } from '@/components/editor/extensions';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

afterEach(cleanup);

function citationNode(id: string, title: string, year: number, formattedApa: string) {
  return {
    type: 'citation',
    attrs: {
      id,
      doi: `10.1234/${id}`,
      formatted_apa: formattedApa,
      formatted_mla: `${formattedApa} (mla)`,
      formatted_chicago: `${formattedApa} (chicago)`,
      raw_authors: ['Smith, J.'],
      raw_title: title,
      raw_year: year,
      journal: 'Journal of Tests',
      url: `https://doi.org/10.1234/${id}`,
    },
  };
}

function Harness({ editable, content }: { editable: boolean; content: Record<string, unknown> }) {
  const editor = useEditor({
    extensions: baseExtensions(),
    editable,
    content,
    immediatelyRender: false,
  });
  return (
    <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
      <EditorContent editor={editor} />
    </I18nProvider>
  );
}

const twoCitations = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'body' }] },
    citationNode('cit-a', 'Alpha study', 2021, 'Smith, J. (2021). Alpha study.'),
    citationNode('cit-b', 'Beta study', 2022, 'Smith, J. (2022). Beta study.'),
  ],
};

describe('citation chip + popover (P5)', () => {
  it('renders numbered superscript chips in bibliography order, not the inline string', async () => {
    render(<Harness editable content={twoCitations} />);
    const chip1 = await screen.findByRole('doc-biblioref', { name: 'Citation 1' });
    const chip2 = await screen.findByRole('doc-biblioref', { name: 'Citation 2' });
    expect(chip1.textContent).toBe('[1]');
    expect(chip2.textContent).toBe('[2]');
    // The full formatted string is NOT inline anymore (popover-only).
    expect(screen.queryByText('Smith, J. (2021). Alpha study.')).toBeNull();
  });

  it('opens the popover on hover with author+year, title and formatted entry; closes on mouseleave', async () => {
    render(<Harness editable content={twoCitations} />);
    const chip1 = await screen.findByRole('doc-biblioref', { name: 'Citation 1' });
    fireEvent.mouseEnter(chip1);
    const popover = screen.getByTestId('citation-popover');
    expect(popover.textContent).toContain('Smith, J. (2021)');
    expect(popover.textContent).toContain('Alpha study');
    expect(popover.textContent).toContain('Smith, J. (2021). Alpha study.');
    // mouseleave fires on the wrapping span so moving into the popover keeps it open.
    fireEvent.mouseLeave(chip1.closest('span.relative') as HTMLElement);
    expect(screen.queryByTestId('citation-popover')).toBeNull();
  });

  it('opens on keyboard focus and closes on Escape and blur (a11y parity)', async () => {
    render(<Harness editable content={twoCitations} />);
    const chip2 = await screen.findByRole('doc-biblioref', { name: 'Citation 2' });
    fireEvent.focus(chip2);
    expect(screen.getByTestId('citation-popover').textContent).toContain('Beta study');
    fireEvent.keyDown(chip2, { key: 'Escape' });
    expect(screen.queryByTestId('citation-popover')).toBeNull();
    fireEvent.focus(chip2);
    expect(screen.getByTestId('citation-popover')).toBeTruthy();
    fireEvent.blur(chip2);
    expect(screen.queryByTestId('citation-popover')).toBeNull();
  });

  it('renders no network request from the popover (attrs only)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);
    try {
      render(<Harness editable content={twoCitations} />);
      const chip1 = await screen.findByRole('doc-biblioref', { name: 'Citation 1' });
      fireEvent.mouseEnter(chip1);
      expect(screen.getByTestId('citation-popover')).toBeTruthy();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shows the chip (not the Add-citation affordance) on read-only surfaces', async () => {
    render(<Harness editable={false} content={twoCitations} />);
    expect(await screen.findByRole('doc-biblioref', { name: 'Citation 1' })).toBeTruthy();
    expect(screen.queryByText('Add citation')).toBeNull();
  });

  it('keeps the Add-citation affordance for empty nodes on editable surfaces only', async () => {
    const emptyCitation = {
      type: 'doc',
      content: [{ type: 'citation', attrs: { id: null } }],
    };
    const { unmount } = render(<Harness editable content={emptyCitation} />);
    expect(await screen.findByText('Add citation')).toBeTruthy();
    unmount();
    cleanup();
    render(<Harness editable={false} content={emptyCitation} />);
    // node view mounts async; give it a tick, then assert the affordance never shows
    await Promise.resolve();
    expect(screen.queryByText('Add citation')).toBeNull();
  });
});
