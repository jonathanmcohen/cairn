// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageMenu } from '@/components/page-menu';

// offline-context + share-panel pull in app providers; mock the action gate to "allowed".
vi.mock('@/components/pwa/offline-context', () => ({ useActionAllowed: () => true }));
// The component reads strings via useT(); render with the authoritative English copy
// instead of wiring a full <I18nProvider> tree into the test.
vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});

afterEach(cleanup);

describe('<PageMenu> item icons', () => {
  it('renders a leading svg icon inside each open-menu action button', async () => {
    render(<PageMenu pageId="11111111-1111-1111-1111-111111111111" />);
    screen.getByRole('button', { name: 'Page menu' }).click();
    // "Export as .md" is always present (published=false path). It must carry an icon.
    const exportBtn = await screen.findByRole('button', { name: /export as \.md/i });
    expect(exportBtn.querySelector('svg')).toBeTruthy();
  });
});
