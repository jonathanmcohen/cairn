// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('editor mounts the dialog host', () => {
  it('imports and renders <EditorDialogs>', () => {
    const src = readFileSync('src/components/editor/editor.tsx', 'utf8');
    expect(src).toContain("import { EditorDialogs } from './editor-dialogs'");
    expect(src).toContain('<EditorDialogs />');
  });
});
