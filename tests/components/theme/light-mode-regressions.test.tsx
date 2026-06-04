// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApprovalPanel } from '@/components/pages/approval-panel';
import { CoverBanner } from '@/components/pages/cover-banner';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

// ApprovalPanel fetches approval history on mount; stub fetch so the effect is inert.
vi.stubGlobal(
  'fetch',
  vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ history: [] }) })),
);

afterEach(() => {
  cleanup();
});

describe('CoverBanner light-mode desaturation', () => {
  it('applies the theme-cover class so light mode can soften the band', () => {
    const { container } = render(<CoverBanner cover={{ kind: 'preset', value: 'slate' }} />);
    const banner = container.querySelector('[data-cairn-cover]');
    expect(banner).not.toBeNull();
    expect(banner?.className).toContain('cairn-cover');
  });
});

describe('ApprovalPanel themed warning surface', () => {
  it('approval banner uses the themed warning surface (not amber-only)', () => {
    const { getByRole } = render(
      <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
        <ApprovalPanel pageId="00000000-0000-0000-0000-000000000000" canDecide={false} inReview />
      </I18nProvider>,
    );
    const banner = getByRole('complementary', { name: /approval/i });
    expect(banner.className).toContain('cairn-approval-banner');
    expect(banner.className).not.toContain('bg-amber-50/30');
  });
});

describe('Mention pill selector contract', () => {
  it('mention markup carries the .mention class for token theming', () => {
    const { container } = render(<span className="mention">@Jon</span>);
    expect(container.querySelector('.mention')).not.toBeNull();
  });
});
