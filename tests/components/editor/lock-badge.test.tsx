// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LockBadge } from '@/components/editor/lock-badge';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

afterEach(cleanup);

function wrap(ui: React.ReactNode) {
  return (
    <I18nProvider locale="en" messages={enMessages}>
      {ui}
    </I18nProvider>
  );
}

describe('<LockBadge> (#134)', () => {
  it('shows "Locked until <time>" when an unlock time is given', () => {
    render(wrap(<LockBadge lockedUntilIso="2030-01-01T15:30:00.000Z" />));
    const badge = screen.getByText(/Locked until/);
    expect(badge.textContent).toContain('🔒');
  });

  it('shows the indefinite label when no unlock time is given', () => {
    render(wrap(<LockBadge lockedUntilIso={null} />));
    expect(screen.getByText(enMessages['editor.lockedBadge.indefinite'])).toBeTruthy();
  });
});
