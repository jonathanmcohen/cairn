// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { ReactElement } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { baseExtensions } from '@/components/editor/extensions';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

// cmdk's <Command> uses ResizeObserver + scrollIntoView, which jsdom omits.
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class NoopResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as unknown as { ResizeObserver: typeof NoopResizeObserver }).ResizeObserver =
      NoopResizeObserver;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

afterEach(cleanup);

function Harness({ json }: { json: object }) {
  const editor = useEditor({
    extensions: baseExtensions(),
    content: json,
    immediatelyRender: false,
  });
  return <EditorContent editor={editor} />;
}

// The NodeView calls useT(), so it must mount inside an I18nProvider.
function wrap(ui: ReactElement) {
  return (
    <I18nProvider locale="en" messages={enMessages}>
      {ui}
    </I18nProvider>
  );
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
    render(wrap(<Harness json={doc} />));
    // The NodeView exposes the current language via an accessible control.
    expect(await screen.findByRole('combobox', { name: /language/i })).toBeTruthy();
  });

  it('opens a searchable list and filters languages by typed text', async () => {
    render(
      wrap(
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
        />,
      ),
    );
    const trigger = await screen.findByRole('combobox', { name: /language/i });
    fireEvent.click(trigger);
    const search = await screen.findByPlaceholderText(/search languages/i);
    fireEvent.change(search, { target: { value: 'rust' } });
    expect(screen.getByText('Rust')).toBeTruthy();
    expect(screen.queryByText('TypeScript')).toBeNull();
  });
});
