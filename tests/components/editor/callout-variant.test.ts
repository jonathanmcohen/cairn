import { getSchema } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { Callout, type CalloutVariant } from '@/components/editor/callout-extension';
import { baseExtensions } from '@/components/editor/extensions';

describe('callout variant', () => {
  it('exposes a variant attr with a default of "note"', () => {
    const schema = getSchema(baseExtensions());
    const node = schema.nodes.callout;
    expect(node).toBeTruthy();
    expect(node?.spec.attrs?.variant?.default).toBe('note');
  });

  it('maps legacy data-color values to variants on parse', () => {
    // addAttributes() doesn't use `this`; call it directly and read the
    // variant attr's parseHTML. Cast to the minimal shape we rely on.
    const addAttributes = Callout.config.addAttributes as
      | undefined
      | (() => { variant: { parseHTML: (el: HTMLElement) => CalloutVariant } });
    const parse = addAttributes?.().variant.parseHTML;
    expect(parse).toBeTruthy();

    const make = (attrs: Record<string, string>): CalloutVariant | undefined => {
      const el = {
        getAttribute: (name: string) => attrs[name] ?? null,
      } as unknown as HTMLElement;
      return parse?.(el);
    };

    // legacy color → variant
    expect(make({ 'data-color': 'blue' })).toBe('note');
    expect(make({ 'data-color': 'green' })).toBe('tip');
    expect(make({ 'data-color': 'amber' })).toBe('warning');
    expect(make({ 'data-color': 'default' })).toBe('note');
    // missing color falls back to note
    expect(make({})).toBe('note');
    // explicit new variant wins
    expect(make({ 'data-variant': 'error' })).toBe('error');
  });
});
