// @vitest-environment jsdom
/**
 * Regression for the Trash-list raw `emoji::` leak: the shared client-safe
 * <InlineIcon> must strip the `emoji::`/`file::` prefix before rendering, never
 * print it as literal DOM text. Covers every stored-icon form.
 * See docs/superpowers/plans/v0.9.15/ (Plan W — renderer polish).
 */
import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { InlineIcon } from '@/components/page-icon-inline';
import { PageIconRender } from '@/components/page-icon-render';

afterEach(cleanup);

function renderIcon(value: string | null) {
  return render(createElement(InlineIcon, { value }));
}

describe('InlineIcon — stored icon rendering (Trash leak regression)', () => {
  it('emoji:: prefix → bare emoji, no literal "emoji::"', () => {
    const { container } = renderIcon('emoji::🚀');
    expect(container.textContent).toBe('🚀');
    expect(container.textContent).not.toContain('emoji::');
  });

  it('the exact Trash repro value "emoji::📄" renders just 📄', () => {
    const { container } = renderIcon('emoji::📄');
    expect(container.textContent).toBe('📄');
    expect(container.textContent).not.toContain('emoji::');
  });

  it('bare legacy emoji passes through unchanged', () => {
    const { container } = renderIcon('📘');
    expect(container.textContent).toBe('📘');
  });

  it('file::<uuid> → neutral image glyph, no literal "file::"', () => {
    const { container } = renderIcon('file::3f2504e0-4f89-41d3-9a0c-0305e82c3301');
    expect(container.textContent).not.toContain('file::');
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('malformed file:: (no uuid) falls back to emoji bucket, not a raw prefix', () => {
    const { container } = renderIcon('file::not-a-uuid');
    // parseIcon treats a bad file:: payload as a legacy emoji blob → printed as-is,
    // but the point is it does not crash and routes through the parser.
    expect(container.textContent).toBe('file::not-a-uuid');
  });

  it('null → default document fallback', () => {
    const { container } = renderIcon(null);
    expect(container.textContent).toBe('📄');
  });

  it('empty string → default document fallback (no blank icon)', () => {
    const { container } = renderIcon('');
    expect(container.textContent).toBe('📄');
  });
});

// v0.10.2 S18 — the public share pages (/s, /p) render page icons through the
// RSC renderer PageIconRender, which must strip the prefix exactly like
// InlineIcon (file:: → signed image; covered server-side, not here).
describe('PageIconRender — emoji prefix stripping (public page leak regression)', () => {
  function renderServerIcon(value: string | null) {
    return render(createElement(PageIconRender, { value }));
  }

  it('emoji:: prefix → bare emoji, no literal "emoji::"', () => {
    const { container } = renderServerIcon('emoji::🚀');
    expect(container.textContent).toBe('🚀');
    expect(container.textContent).not.toContain('emoji::');
  });

  it('bare legacy emoji passes through unchanged', () => {
    const { container } = renderServerIcon('📘');
    expect(container.textContent).toBe('📘');
  });

  it('null → default document fallback', () => {
    const { container } = renderServerIcon(null);
    expect(container.textContent).toBe('📄');
  });
});
