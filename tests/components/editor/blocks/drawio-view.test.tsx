// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import type { NodeViewProps } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DrawioView } from '@/components/editor/blocks/drawio';

afterEach(() => {
  cleanup();
});

/**
 * v0.9.0 G3 P15 review fix — encrypted-page leak guard. drawio's viewer
 * receives the XML via the iframe `src` query string (`data=` or `url=`), so
 * an E2E page would ship DECRYPTED diagram XML to viewer.diagrams.net once
 * the client decrypts. The view must render a placeholder (no iframe, no
 * viewer URL) when `editor.storage.cairn.encrypted === true`.
 */
function makeEditor(encrypted: boolean): NodeViewProps['editor'] {
  return {
    storage: { cairn: { pageId: 'p1', encrypted } },
    isEditable: true,
  } as unknown as NodeViewProps['editor'];
}

function makeNode(source: string, sourceUrl = ''): NodeViewProps['node'] {
  return { attrs: { source, sourceUrl } } as unknown as NodeViewProps['node'];
}

const XML = '<mxGraphModel><root>secret-payload-marker</root></mxGraphModel>';

describe('DrawioView — encrypted-page guard', () => {
  it('renders a placeholder div and NO <iframe src> when encrypted=true', () => {
    const { container } = render(
      <DrawioView
        {...({
          node: makeNode(XML),
          editor: makeEditor(true),
          updateAttributes: () => {},
        } as unknown as NodeViewProps)}
      />,
    );
    expect(container.querySelector('[data-encrypted-placeholder="drawio"]')).not.toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.innerHTML).not.toMatch(/viewer\.diagrams\.net/);
    expect(container.innerHTML).not.toContain('secret-payload-marker');
  });

  it('renders the iframe (NO placeholder) when encrypted=false', () => {
    const { container } = render(
      <DrawioView
        // biome-ignore lint/suspicious/noExplicitAny: stub props for view-level test
        {...({
          node: makeNode(XML),
          editor: makeEditor(false),
          updateAttributes: () => {},
        } as unknown as NodeViewProps)}
      />,
    );
    expect(container.querySelector('[data-encrypted-placeholder="drawio"]')).toBeNull();
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute('src')).toMatch(/^https:\/\/viewer\.diagrams\.net\//);
  });
});
