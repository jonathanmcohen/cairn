// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enMessages from '@/../messages/en.json';
import { MoveToPicker } from '@/components/sidebar/move-to-picker';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(cleanup);
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ nodes: [] }) })) as never,
  );
});

describe('sidebar page/file glyphs are lucide svg, not emoji', () => {
  it('renders no 📄/🖼️ emoji in the move-to top-level row', () => {
    const { container } = render(
      <I18nProvider locale="en" messages={enMessages}>
        <MoveToPicker
          open
          sourceId="00000000-0000-0000-0000-000000000001"
          onOpenChange={() => {}}
          onMoved={() => {}}
        />
      </I18nProvider>,
    );
    // The dialog is portalled to document.body.
    expect(document.body.textContent ?? '').not.toMatch(/📄|🖼️/);
    // The "Top level" row already used a CornerLeftUp lucide icon — assert svgs exist.
    expect(document.body.querySelectorAll('svg').length).toBeGreaterThan(0);
    container.remove();
  });
});
