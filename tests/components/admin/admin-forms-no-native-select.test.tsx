import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FILES = [
  'src/app/(app)/admin/siem/forwarder-form.tsx',
  'src/app/(app)/settings/admin/chat-bridge/channels/channel-link-form.tsx',
];

describe('admin forms use themed Select (#38)', () => {
  for (const rel of FILES) {
    it(`${rel} has no raw <select`, () => {
      const text = readFileSync(join(process.cwd(), rel), 'utf8');
      expect(text).not.toMatch(/<select[\s>]/);
    });
  }
});
