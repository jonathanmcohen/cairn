/**
 * Plan C3 (#141) — editor block spacing tokens.
 * Contract stub. Real assertions land with Plan C3.
 * See docs/superpowers/v0.9.14/plan-C-ui-density-polish.md.
 */
import { describe, it } from 'vitest';

describe('Plan C3 #141 — editor block spacing', () => {
  it.todo('globals.css defines --cairn-block-gap');
  it.todo('.ProseMirror block-flow margins applied (h1/h2/h3 + p/ul/ol/li/blockquote/pre)');
  it.todo('margins are scoped to .ProseMirror[contenteditable="true"] (editor only, NOT public /p/* reader)');
  it.todo('no bare unscoped .ProseMirror margin rule exists (would leak to read-only reader)');
});
