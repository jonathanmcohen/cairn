// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { EditorContent, useEditor } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import { baseExtensions } from '@/components/editor/extensions';

afterEach(cleanup);

function Harness() {
  const editor = useEditor({
    extensions: baseExtensions(),
    content: {
      type: 'doc',
      content: [
        { type: 'callout', attrs: { variant: 'warning' }, content: [{ type: 'paragraph' }] },
      ],
    },
    immediatelyRender: false,
  });
  return <EditorContent editor={editor} />;
}

describe('callout view', () => {
  it('renders a variant type picker reflecting the node variant', async () => {
    render(<Harness />);
    expect(await screen.findByRole('combobox', { name: /callout type/i })).toBeTruthy();
  });
});
