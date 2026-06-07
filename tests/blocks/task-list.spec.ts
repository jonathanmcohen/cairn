/**
 * Plan B1 (#138) — task/checkbox list flex layout.
 *
 * `@tiptap/extension-list` renders `<ul data-type="taskList">` containing
 * `<li data-type="taskItem">` with a `<label>` (the checkbox) and a `<div>`
 * (the content). Without flex the checkbox stacks above the text. CSS computed
 * styles are not available under jsdom, so these assert against the raw CSS
 * text in `blocks.css`.
 * See docs/superpowers/plans/v0.9.14/plan-B-editor-block-fixes.md.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(
  new URL('../../src/components/editor/blocks.css', import.meta.url),
  'utf8',
);

describe('Plan B1 #138 — task-list layout', () => {
  it('blocks.css declares ul[data-type="taskList"] li { display:flex; align-items:baseline }', () => {
    expect(CSS).toMatch(/ul\[data-type="taskList"\]\s+li\s*\{[^}]*display:\s*flex/);
    expect(CSS).toMatch(/ul\[data-type="taskList"\]\s+li\s*\{[^}]*align-items:\s*baseline/);
  });

  it('task-list label is flex:none (checkbox column does not stretch)', () => {
    expect(CSS).toMatch(/ul\[data-type="taskList"\]\s+li\s*>\s*label\s*\{[^}]*flex:\s*none/);
  });

  it('task-list content div is flex:1 and sits inline with the checkbox', () => {
    expect(CSS).toMatch(/ul\[data-type="taskList"\]\s+li\s*>\s*div\s*\{[^}]*flex:\s*1/);
  });

  it('nested task lists indent without re-stacking the checkbox', () => {
    expect(CSS).toMatch(/ul\[data-type="taskList"\]\s+ul\[data-type="taskList"\]/);
    // The base list also strips the default bullet so the row reads as a checkbox.
    expect(CSS).toMatch(/ul\[data-type="taskList"\]\s*\{[^}]*list-style:\s*none/);
  });
});
