// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { EditorContent, useEditor } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import { baseExtensions } from '@/components/editor/extensions';

afterEach(cleanup);

function Harness({
  editable,
  empty,
  open = true,
}: {
  editable: boolean;
  empty: boolean;
  open?: boolean;
}) {
  const editor = useEditor({
    extensions: baseExtensions(),
    editable,
    content: {
      type: 'doc',
      content: [
        {
          type: 'toggle',
          attrs: { open },
          content: empty
            ? [{ type: 'paragraph' }]
            : [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
        },
      ],
    },
    immediatelyRender: false,
  });
  return <EditorContent editor={editor} />;
}

describe('toggle view empty placeholder', () => {
  it('shows an Empty placeholder for an open editable toggle with no content', async () => {
    render(<Harness editable empty />);
    expect(await screen.findByText(/Empty/i)).toBeTruthy();
  });

  it('hides the placeholder when content is present', async () => {
    render(<Harness editable empty={false} />);
    // give the editor a tick to mount the node-view
    await screen.findByText('hello');
    expect(screen.queryByText(/Empty/i)).toBeNull();
  });

  it('hides the placeholder for viewers', async () => {
    render(<Harness editable={false} empty />);
    // node-view still mounts; just assert the placeholder never shows
    await Promise.resolve();
    expect(screen.queryByText(/Empty/i)).toBeNull();
  });
});
