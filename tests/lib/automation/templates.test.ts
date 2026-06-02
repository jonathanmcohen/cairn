import { describe, expect, it } from 'vitest';
import { compileBuilder } from '@/lib/automation/builder';
import { BUILDER_TEMPLATES } from '@/lib/automation/templates';

describe('BUILDER_TEMPLATES', () => {
  it('is a non-empty array of well-formed templates', () => {
    expect(BUILDER_TEMPLATES.length).toBeGreaterThan(0);
    for (const tpl of BUILDER_TEMPLATES) {
      expect(typeof tpl.id).toBe('string');
      expect(typeof tpl.nameKey).toBe('string');
      const model = tpl.build();
      // Either compiles, or fails only because a picker isn't filled yet.
      const res = compileBuilder('Template rule', model);
      if (!res.ok) {
        expect(res.error).toMatch(/needs a/i);
      }
    }
  });

  it('includes the three named presets', () => {
    const ids = BUILDER_TEMPLATES.map((t) => t.id);
    expect(ids).toContain('notify-high-priority');
    expect(ids).toContain('auto-assign-mention');
    expect(ids).toContain('archive-on-done');
  });

  it('every template exposes a searchable descKey', () => {
    for (const tpl of BUILDER_TEMPLATES) {
      expect(typeof tpl.descKey).toBe('string');
      expect(tpl.descKey.length).toBeGreaterThan(0);
    }
  });

  it('archive-on-done builds a row.updated trigger with a status equals Done condition', () => {
    const tpl = BUILDER_TEMPLATES.find((t) => t.id === 'archive-on-done');
    if (!tpl) throw new Error('missing template');
    const model = tpl.build();
    expect(model.triggerEvent).toBe('row.updated');
    expect(model.conditions.children).toHaveLength(1);
    const leaf = model.conditions.children[0];
    expect(leaf && 'field' in leaf ? leaf.field : null).toBe('row.cells.status');
    expect(leaf && 'op' in leaf ? leaf.op : null).toBe('equals');
    expect(leaf && 'value' in leaf ? leaf.value : null).toBe('Done');
  });
});
