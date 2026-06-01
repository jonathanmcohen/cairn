import { describe, expect, it } from 'vitest';
import { getMessages } from '@/lib/i18n/messages';

const KEYS = [
  'automation.builder.addGroup',
  'automation.builder.removeGroup',
  'automation.builder.dragAction',
  'automation.builder.moveActionDown',
  'automation.builder.templates.search',
  'automation.builder.templates.empty',
  'automation.builder.templates.notifyHighPriorityDesc',
  'automation.builder.templates.autoAssignMentionDesc',
  'automation.builder.templates.archiveOnDoneDesc',
];

describe('G5 automation i18n keys', () => {
  for (const locale of ['en', 'es', 'ar'] as const) {
    it(`${locale} has every new key, non-empty`, () => {
      const m = getMessages(locale) as Record<string, string>;
      for (const k of KEYS) {
        expect(m[k], `${locale} missing ${k}`).toBeTruthy();
      }
    });
  }
});
