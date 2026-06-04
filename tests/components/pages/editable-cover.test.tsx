// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditableCover } from '@/components/pages/editable-cover';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(cleanup);

function wrap(ui: React.ReactNode) {
  return render(
    <I18nProvider locale="en" messages={enMessages}>
      {ui}
    </I18nProvider>,
  );
}

describe('EditableCover (#239)', () => {
  it('renders the cover inside a labelled edit button and opens the picker on click', () => {
    wrap(
      <EditableCover pageId="p1" cover={{ kind: 'preset', value: 'slate-dusk' }} alt="My page" />,
    );
    const trigger = screen.getByRole('button', { name: enMessages['cover.editAria'] });
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: enMessages['cover.dialogTitle'] })).toBeTruthy();
  });

  it('renders nothing for an empty cover (no banner to click)', () => {
    wrap(<EditableCover pageId="p1" cover={{}} alt="My page" />);
    expect(screen.queryByRole('button', { name: enMessages['cover.editAria'] })).toBeNull();
  });
});
