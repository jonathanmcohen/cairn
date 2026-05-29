// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { EDITOR_CONTENT_CLASS } from '@/components/editor/editor';

// Regression guard for GH #123 ("border glow bug"): the global
// `:focus-visible { outline: 2px solid hsl(var(--ring)) }` rule (globals.css)
// painted the theme accent ring around the whole .ProseMirror writing surface
// after slash-menu teardown returned keyboard-style focus to the editor. Under
// the amber/rose accents `--ring` is orange/red, so the 50vh-tall surface read
// as a stuck error glow. The fix neutralizes :focus-visible on this one large
// surface (the caret is its focus affordance) while leaving discrete-control
// focus rings — buttons, inputs, links — untouched for WCAG 2.4.7.
describe('editor contenteditable focus treatment', () => {
  it('suppresses the focus-visible outline on the writing surface', () => {
    // Neutralizes the global accent :focus-visible ring on the large editor
    // surface so it can't paint a viewport-spanning glow.
    expect(EDITOR_CONTENT_CLASS).toContain('focus-visible:outline-hidden');
  });

  it('keeps the :focus outline suppression (no mouse-click outline either)', () => {
    expect(EDITOR_CONTENT_CLASS).toContain('focus:outline-hidden');
  });
});
