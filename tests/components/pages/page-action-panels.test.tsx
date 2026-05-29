// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageActionPanels } from '@/components/pages/page-action-panels';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function wrap(ui: React.ReactNode) {
  return (
    <I18nProvider locale="en" messages={enMessages}>
      {ui}
    </I18nProvider>
  );
}

function renderPanels() {
  return render(
    wrap(
      <PageActionPanels
        pageId="p1"
        canComment
        currentUserId="u1"
        currentRole="editor"
        canEditVersions
        canLock
      />,
    ),
  );
}

describe('<PageActionPanels>', () => {
  it('keeps only one panel open at a time (mutual exclusion)', () => {
    renderPanels();
    // Open comments → its drawer (heading) is visible.
    fireEvent.click(screen.getByRole('button', { name: enMessages['pageActions.comments.title'] }));
    expect(screen.getByText(enMessages['pageActions.comments.empty.title'])).toBeTruthy();

    // Open versions → comments drawer gone, versions drawer visible.
    fireEvent.click(screen.getByRole('button', { name: enMessages['pageActions.versions.title'] }));
    expect(screen.queryByText(enMessages['pageActions.comments.empty.title'])).toBeNull();
    expect(screen.getByText(enMessages['pageActions.versions.empty.title'])).toBeTruthy();
  });

  it('dismisses the open panel on Escape', () => {
    renderPanels();
    fireEvent.click(screen.getByRole('button', { name: enMessages['pageActions.comments.title'] }));
    expect(screen.getByText(enMessages['pageActions.comments.empty.title'])).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText(enMessages['pageActions.comments.empty.title'])).toBeNull();
  });
});
