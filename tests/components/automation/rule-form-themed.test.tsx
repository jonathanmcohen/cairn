import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('automation rule-form uses themed Select (#38)', () => {
  it('has no raw <select', () => {
    const text = readFileSync(
      join(process.cwd(), 'src/components/automation/rule-form.tsx'),
      'utf8',
    );
    expect(text).not.toMatch(/<select[\s>]/);
  });
});
