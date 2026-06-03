// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { E2EEnrollCard } from '@/components/security/e2e-enroll-card';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';

function wrap(node: ReactNode) {
  return (
    <I18nProvider locale="en" messages={getMessages('en')}>
      {node}
    </I18nProvider>
  );
}
afterEach(cleanup);

describe('E2EEnrollCard disabled state (#193)', () => {
  it('renders the informational notice (not a destructive error) when disabled', () => {
    const { container } = render(wrap(<E2EEnrollCard enabled={false} />));
    // informational title + docs link from the shared notice
    expect(screen.getByText('End-to-end encryption is turned off in this build.')).toBeTruthy();
    expect(screen.getByText('Read the encryption admin guide')).toBeTruthy();
    // no destructive red text in the disabled branch
    expect(container.querySelector('.text-destructive')).toBeNull();
    expect(container.querySelector('.bg-muted\\/40')).not.toBeNull();
  });
});
