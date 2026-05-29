// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { EditorContent, useEditor } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import { baseExtensions } from '@/components/editor/extensions';

afterEach(cleanup);

function Harness({ json }: { json: object }) {
  const editor = useEditor({
    extensions: baseExtensions(),
    content: json,
    immediatelyRender: false,
  });
  return <EditorContent editor={editor} />;
}

describe('code block language selector', () => {
  it('renders a language control reflecting the node language attr', async () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'python' },
          content: [{ type: 'text', text: 'print(1)' }],
        },
      ],
    };
    render(<Harness json={doc} />);
    // The NodeView exposes the current language via an accessible control.
    expect(await screen.findByRole('combobox', { name: /language/i })).toBeTruthy();
  });
});
