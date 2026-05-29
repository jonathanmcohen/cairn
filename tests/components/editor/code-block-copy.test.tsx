// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorContent, useEditor } from '@tiptap/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { baseExtensions } from '@/components/editor/extensions';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

afterEach(cleanup);

function Harness({ json }: { json: object }) {
  const editor = useEditor({
    extensions: baseExtensions(),
    content: json,
    immediatelyRender: false,
  });
  return <EditorContent editor={editor} />;
}

describe('code block copy button', () => {
  it('copies the block text content to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(
      <I18nProvider locale="en" messages={enMessages}>
        <Harness
          json={{
            type: 'doc',
            content: [
              {
                type: 'codeBlock',
                attrs: { language: 'python' },
                content: [{ type: 'text', text: 'print(1)' }],
              },
            ],
          }}
        />
      </I18nProvider>,
    );
    const copy = await screen.findByRole('button', { name: /copy code/i });
    fireEvent.click(copy);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('print(1)'));
  });
});
