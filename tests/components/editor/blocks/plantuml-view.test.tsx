// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import type { NodeViewProps } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PlantUmlView } from '@/components/editor/blocks/plantuml';

afterEach(() => {
  cleanup();
});

/**
 * v0.9.0 G3 P15 review fix — encrypted-page leak guard. When the page-detail
 * shell stamps `editor.storage.cairn.encrypted = true`, the PlantUML view must
 * NOT construct a www.plantuml.com URL nor render an <img src> pointing at the
 * external server (which would defeat the E2E posture by shipping plaintext
 * source to the diagram host once the client decrypts).
 */
function makeEditor(encrypted: boolean): NodeViewProps['editor'] {
  // The view only reads `editor.storage.cairn.encrypted` + `editor.isEditable`.
  return {
    storage: { cairn: { pageId: 'p1', encrypted } },
    isEditable: true,
  } as unknown as NodeViewProps['editor'];
}

function makeNode(source: string): NodeViewProps['node'] {
  return { attrs: { source } } as unknown as NodeViewProps['node'];
}

const SOURCE = '@startuml\nAlice -> Bob: secret-payload-marker\n@enduml';

describe('PlantUmlView — encrypted-page guard', () => {
  it('renders a placeholder div and NO <img src> when encrypted=true', () => {
    const { container } = render(
      <PlantUmlView
        {...({
          node: makeNode(SOURCE),
          editor: makeEditor(true),
          updateAttributes: () => {},
        } as unknown as NodeViewProps)}
      />,
    );
    // Placeholder marker present.
    expect(container.querySelector('[data-encrypted-placeholder="plantuml"]')).not.toBeNull();
    // No <img> at all, and the DOM must not contain the plantuml host URL.
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toMatch(/plantuml\.com/);
    expect(container.innerHTML).not.toContain('secret-payload-marker');
  });

  it('renders WITHOUT the encrypted placeholder when encrypted=false', () => {
    const { container } = render(
      <PlantUmlView
        // biome-ignore lint/suspicious/noExplicitAny: stub props for view-level test
        {...({
          node: makeNode(SOURCE),
          editor: makeEditor(false),
          updateAttributes: () => {},
        } as unknown as NodeViewProps)}
      />,
    );
    expect(container.querySelector('[data-encrypted-placeholder="plantuml"]')).toBeNull();
  });
});
