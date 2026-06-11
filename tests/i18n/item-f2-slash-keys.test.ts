import { describe, expect, it } from 'vitest';
import ar from '../../messages/ar.json' with { type: 'json' };
import en from '../../messages/en.json' with { type: 'json' };
import es from '../../messages/es.json' with { type: 'json' };

// v0.10.0 F2 — custom slash-command settings strings must exist in all three
// locale catalogs (mirrors the F1 brand parity test).
const KEYS = [
  'settings.nav.workspace.slashCommands',
  'slash.group.workspace',
  'workspaceSettings.slashCommands.title',
  'workspaceSettings.slashCommands.description',
  'workspaceSettings.slashCommands.staleHint',
  'workspaceSettings.slashCommands.empty',
  'workspaceSettings.slashCommands.triggerLabel',
  'workspaceSettings.slashCommands.triggerPlaceholder',
  'workspaceSettings.slashCommands.triggerHint',
  'workspaceSettings.slashCommands.labelLabel',
  'workspaceSettings.slashCommands.labelPlaceholder',
  'workspaceSettings.slashCommands.templateLabel',
  'workspaceSettings.slashCommands.templatePlaceholder',
  'workspaceSettings.slashCommands.noTemplates',
  'workspaceSettings.slashCommands.create',
  'workspaceSettings.slashCommands.creating',
  'workspaceSettings.slashCommands.delete',
  'workspaceSettings.slashCommands.errorBuiltin',
  'workspaceSettings.slashCommands.errorDuplicate',
  'workspaceSettings.slashCommands.errorInvalidTrigger',
  'workspaceSettings.slashCommands.errorTemplateNotFound',
  'workspaceSettings.slashCommands.errorTemplateNotInsertable',
  'workspaceSettings.slashCommands.errorGeneric',
] as const;

describe('F2 custom slash-command i18n keys', () => {
  for (const cat of [
    ['en', en],
    ['es', es],
    ['ar', ar],
  ] as const) {
    const [name, messages] = cat;
    const m = messages as Record<string, string>;
    for (const k of KEYS) {
      it(`${name} has ${k}`, () => {
        const value = m[k];
        expect(typeof value).toBe('string');
        expect((value ?? '').length).toBeGreaterThan(0);
      });
    }
  }
});
