// @vitest-environment jsdom
/**
 * Plan B3 (#117) — heading collapse chevron (regression; already shipped v0.9.13).
 *
 * `HeadingCollapse` is a per-viewer React overlay (NOT a registered TipTap
 * extension): it is mounted in `editor.tsx` and hides/shows the top-level blocks
 * between a heading and the next equal-or-higher-level heading. These tests
 * document the shipped behavior so a regression cannot silently land:
 *   1. the overlay stays mounted in editor.tsx (wiring guard),
 *   2. hovering a heading reveals the collapse chevron affordance,
 *   3. clicking it hides the following sibling blocks and flips to "expand".
 * See docs/superpowers/plans/v0.9.14/plan-B-editor-block-fixes.md.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { baseExtensions } from '@/components/editor/extensions';
import { HeadingCollapse } from '@/components/editor/heading-collapse';

vi.mock('@/lib/i18n/provider', () => ({ useT: () => (k: string) => k }));

// `import.meta.url` is not a file:// URL under the jsdom environment, so read
// the source relative to the project root (process.cwd() is the repo root).
const EDITOR_SRC = readFileSync(resolve(process.cwd(), 'src/components/editor/editor.tsx'), 'utf8');

let editor: Editor;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  editor = new Editor({
    element: host,
    extensions: baseExtensions({ undoRedo: true }),
    content: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'A' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'body' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'B' }] },
      ],
    },
  });
});

afterEach(() => {
  cleanup();
  editor.destroy();
  host.remove();
});

describe('Plan B3 #117 — heading collapse (regression)', () => {
  it('heading-collapse overlay stays mounted in editor.tsx', () => {
    expect(EDITOR_SRC).toContain("import { HeadingCollapse } from './heading-collapse'");
    expect(EDITOR_SRC).toMatch(/<HeadingCollapse\s+editor=\{editor\}\s*\/>/);
  });

  it('collapse chevron affordance renders on a heading', () => {
    render(<HeadingCollapse editor={editor} />);
    const h2 = editor.view.dom.querySelector('h2') as HTMLElement;
    fireEvent.mouseMove(h2);
    const btn = screen.getByLabelText('editor.heading.collapse');
    expect(btn).toBeTruthy();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  it('toggling collapse hides/shows the following sibling blocks', () => {
    render(<HeadingCollapse editor={editor} />);
    const h2 = editor.view.dom.querySelector('h2') as HTMLElement;
    fireEvent.mouseMove(h2);

    const para = editor.view.dom.querySelector('p') as HTMLElement;
    const secondHeading = editor.view.dom.querySelectorAll('h2')[1] as HTMLElement;
    expect(para.hasAttribute('hidden')).toBe(false);

    fireEvent.click(screen.getByLabelText('editor.heading.collapse'));
    expect(para.hasAttribute('hidden')).toBe(true);
    // The equal-level sibling heading B bounds the collapse — it stays visible.
    expect(secondHeading.hasAttribute('hidden')).toBe(false);

    fireEvent.click(screen.getByLabelText('editor.heading.expand'));
    expect(para.hasAttribute('hidden')).toBe(false);
  });
});
