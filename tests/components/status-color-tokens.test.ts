import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const editor = readFileSync(join(process.cwd(), 'src/components/editor/editor.tsx'), 'utf8');
const toolbar = readFileSync(
  join(process.cwd(), 'src/components/editor/suggestion-toolbar.tsx'),
  'utf8',
);
// v0.10.2 S14 — the collab status-dot color map (STATUS_DOT) was lifted out of
// editor.tsx into a shared module so the new sidebar-footer pill reuses it. The
// semantic-token assertion now targets that shared source.
const collabStatus = readFileSync(
  join(process.cwd(), 'src/components/collab/collab-status.ts'),
  'utf8',
);

describe('status colors use semantic tokens (#3)', () => {
  it('collab status dot uses warning/success tokens, no raw palette', () => {
    expect(editor).not.toMatch(/bg-amber-500/);
    expect(editor).not.toMatch(/bg-emerald-500/);
    expect(collabStatus).not.toMatch(/bg-amber-500/);
    expect(collabStatus).not.toMatch(/bg-emerald-500/);
    expect(collabStatus).toMatch(/bg-warning/);
    expect(collabStatus).toMatch(/bg-success/);
  });
  it('suggestion accept/reject use success/destructive tokens, no raw palette', () => {
    expect(toolbar).not.toMatch(/text-green-700/);
    expect(toolbar).not.toMatch(/text-red-700/);
    expect(toolbar).toMatch(/text-success/);
    expect(toolbar).toMatch(/text-destructive/);
  });
});
