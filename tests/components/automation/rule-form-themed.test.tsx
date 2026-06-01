import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The raw-JSON RuleForm was replaced by the visual RuleCanvas + typed cards.
// Guard that the canvas and its action cards use themed primitives — no raw
// <select> and no raw <textarea> for action config (#38, finding T).
const FILES = [
  'src/components/automation/builder/rule-canvas.tsx',
  'src/components/automation/builder/action-card-host.tsx',
  'src/components/automation/builder/notify-card.tsx',
  'src/components/automation/builder/set-property-card.tsx',
  'src/components/automation/builder/create-page-card.tsx',
  'src/components/automation/builder/send-webhook-card.tsx',
  'src/components/automation/builder/condition-group.tsx',
];

describe('automation canvas uses themed primitives (no raw select/textarea)', () => {
  for (const file of FILES) {
    it(`${file} has no raw <select or <textarea`, () => {
      const text = readFileSync(join(process.cwd(), file), 'utf8');
      expect(text).not.toMatch(/<select[\s>]/);
      expect(text).not.toMatch(/<textarea[\s>]/);
    });
  }
});
