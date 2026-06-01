// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { CoverPicker } from '@/components/pages/cover-picker';

afterEach(cleanup);

function renderWithI18n(ui: ReactNode) {
  return render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      {ui}
    </I18nProvider>,
  );
}

describe('<CoverPicker> modal focus + escape', () => {
  it('traps focus into the dialog when opened', async () => {
    renderWithI18n(<CoverPicker pageId="p1" current={{}} />);
    fireEvent.click(screen.getByRole('button', { name: /add cover/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('closes on Escape', async () => {
    renderWithI18n(<CoverPicker pageId="p1" current={{}} />);
    fireEvent.click(screen.getByRole('button', { name: /add cover/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
