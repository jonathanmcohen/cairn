// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EditorContent, useEditor } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import { baseExtensions } from '@/components/editor/extensions';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

afterEach(cleanup);

// The NodeView calls useT(), so it must mount inside an I18nProvider.
function Harness({ editable, src }: { editable: boolean; src: string | null }) {
  const editor = useEditor({
    extensions: baseExtensions(),
    editable,
    content: {
      type: 'doc',
      content: [{ type: 'cairnImage', attrs: { src, alt: null, fileId: null } }],
    },
    immediatelyRender: false,
  });
  return (
    <I18nProvider locale="en" messages={enMessages}>
      <EditorContent editor={editor} />
    </I18nProvider>
  );
}

describe('image view empty-state (#139)', () => {
  it('shows an upload CTA for an empty editable image', async () => {
    render(<Harness editable src={null} />);
    expect(await screen.findByText(/Upload an image/i)).toBeTruthy();
  });

  it('reveals a URL input when the URL toggle is clicked', async () => {
    render(<Harness editable src={null} />);
    fireEvent.click(await screen.findByRole('button', { name: /embed a url/i }));
    expect(screen.getByPlaceholderText(/paste an image url/i)).toBeTruthy();
  });

  it('renders the <img> once a src is present (no CTA)', async () => {
    render(<Harness editable src="/api/files/abc" />);
    const img = await screen.findByRole('img');
    expect(img.getAttribute('src')).toBe('/api/files/abc');
    expect(screen.queryByText(/Upload an image/i)).toBeNull();
  });

  it('shows a muted empty notice for viewers (no CTA)', async () => {
    render(<Harness editable={false} src={null} />);
    await Promise.resolve();
    expect(screen.queryByText(/Upload an image/i)).toBeNull();
    expect(screen.getByText(/Empty image/i)).toBeTruthy();
  });
});
