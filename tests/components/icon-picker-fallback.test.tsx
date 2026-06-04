// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { IconPicker } from '@/components/icon-picker';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../messages/en.json';

afterEach(cleanup);

function wrap(ui: React.ReactNode) {
  return render(
    <I18nProvider locale="en" messages={enMessages}>
      {ui}
    </I18nProvider>,
  );
}

describe('<IconPicker> fallback glyph', () => {
  it('renders a lucide svg (not 📄) when no icon is set', () => {
    wrap(<IconPicker value={null} onChange={() => {}} />);
    const trigger = screen.getByRole('button', { name: enMessages['iconPicker.changeAria'] });
    expect(trigger.textContent ?? '').not.toMatch(/📄|🖼️/);
    expect(trigger.querySelector('svg')).toBeTruthy();
  });

  it('still renders a chosen emoji as text content', () => {
    wrap(<IconPicker value="emoji::🪨" onChange={() => {}} />);
    expect(
      screen.getByRole('button', { name: enMessages['iconPicker.changeAria'] }).textContent,
    ).toContain('🪨');
  });
});
