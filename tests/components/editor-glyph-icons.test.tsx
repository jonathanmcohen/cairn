// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import enMessages from '@/../messages/en.json';
import { EditorLinkPopover } from '@/components/editor/editor-link-popover';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(cleanup);

describe('editor glyph buttons use lucide svg', () => {
  it('link popover apply + remove render svg, not ↵/✕', () => {
    render(
      <I18nProvider locale="en" messages={enMessages}>
        <EditorLinkPopover
          initialHref="https://x.test"
          onApply={() => {}}
          onRemove={() => {}}
          onCancel={() => {}}
        />
      </I18nProvider>,
    );
    const apply = screen.getByRole('button', { name: 'Apply link' });
    const remove = screen.getByRole('button', { name: 'Remove link' });
    expect(apply.querySelector('svg')).toBeTruthy();
    expect(remove.querySelector('svg')).toBeTruthy();
    expect(apply.textContent ?? '').not.toMatch(/↵/);
    expect(remove.textContent ?? '').not.toMatch(/✕/);
  });
});
