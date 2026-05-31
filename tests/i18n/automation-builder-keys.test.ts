import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const KEYS = [
  'automation.builder.triggerCard.title',
  'automation.builder.addCondition',
  'automation.builder.addAction',
  'automation.builder.combinator.and',
  'automation.builder.combinator.or',
  'automation.builder.action.notify',
  'automation.builder.action.set_property',
  'automation.builder.action.create_page',
  'automation.builder.action.send_webhook',
  'automation.builder.notify.user',
  'automation.builder.notify.message',
  'automation.builder.setProperty.database',
  'automation.builder.setProperty.property',
  'automation.builder.setProperty.value',
  'automation.builder.createPage.parent',
  'automation.builder.createPage.template',
  'automation.builder.sendWebhook.webhook',
  'automation.builder.test',
  'automation.builder.testResult.wouldRun',
  'automation.builder.testResult.conditionUnmet',
  'automation.builder.testResult.invalidConfig',
  'automation.builder.save',
  'automation.builder.cancel',
  'automation.builder.disable',
  'automation.builder.enable',
  'automation.builder.delete',
  'automation.builder.tab.builder',
  'automation.builder.tab.runs',
  'automation.builder.templates.title',
  'automation.builder.runs.empty',
  'automation.builder.runs.status',
  'automation.builder.runs.payload',
];

function load(locale: string): Record<string, string> {
  return JSON.parse(readFileSync(join(process.cwd(), `messages/${locale}.json`), 'utf8'));
}

describe('automation builder i18n keys', () => {
  for (const locale of ['en', 'es', 'ar']) {
    it(`${locale} has all builder keys`, () => {
      const m = load(locale);
      for (const k of KEYS) expect(m[k], `${locale} missing ${k}`).toBeTypeOf('string');
    });
  }
});
