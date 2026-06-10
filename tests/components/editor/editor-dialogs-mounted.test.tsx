// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('editor mounts the dialog host', () => {
  it('imports and renders <EditorDialogs>', () => {
    const src = readFileSync('src/components/editor/editor.tsx', 'utf8');
    expect(src).toContain("import { EditorDialogs } from './editor-dialogs'");
    // v0.9.19 A2 (#76) — the host now receives the editor so it can refocus the
    // view when a slash dialog closes (focus-restore fix).
    expect(src).toContain('<EditorDialogs editor={editor} />');
  });
});
