// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { EditorContent, useEditor } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import { baseExtensions } from '@/components/editor/extensions';

afterEach(cleanup);

function Harness({ editable, href }: { editable: boolean; href: string | null }) {
  const editor = useEditor({
    extensions: baseExtensions(),
    editable,
    content: {
      type: 'doc',
      content: [
        {
          type: 'fileAttachment',
          attrs: {
            href,
            name: href ? 'report.pdf' : 'file',
            mimeType: 'application/pdf',
            size: 0,
            fileId: null,
          },
        },
      ],
    },
    immediatelyRender: false,
  });
  return <EditorContent editor={editor} />;
}

describe('file view empty-state (#139)', () => {
  it('shows an Upload a file CTA for an empty editable attachment', async () => {
    render(<Harness editable href={null} />);
    expect(await screen.findByRole('button', { name: /upload a file/i })).toBeTruthy();
  });

  it('renders a download link once href is present (no CTA)', async () => {
    render(<Harness editable href="/api/files/abc" />);
    const link = await screen.findByRole('link', { name: /report\.pdf/i });
    expect(link.getAttribute('href')).toBe('/api/files/abc');
    expect(screen.queryByRole('button', { name: /upload a file/i })).toBeNull();
  });

  it('shows a muted notice for viewers on an empty attachment', async () => {
    render(<Harness editable={false} href={null} />);
    await Promise.resolve();
    expect(screen.queryByRole('button', { name: /upload a file/i })).toBeNull();
    expect(screen.getByText(/Empty file/i)).toBeTruthy();
  });
});
