// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ShareDialog } from '@/components/pages/share-dialog';
import { I18nProvider } from '@/lib/i18n/provider';
import en from '../../../messages/en.json';

afterEach(cleanup);

function renderOpen() {
  return render(
    <I18nProvider locale="en" messages={en as Record<string, string>}>
      <ShareDialog open onOpenChange={() => {}} pageId="p1" slug="my-page" />
    </I18nProvider>,
  );
}

describe('<ShareDialog>', () => {
  it('renders a focus-trap dialog titled "Share" with the public link', () => {
    renderOpen();
    const dialog = screen.getByRole('dialog', { name: en['share.title'] });
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('/p/my-page');
  });
});
