// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EncryptionDisabledNotice } from '@/components/admin/encryption-disabled-notice';
import { I18nProvider } from '@/lib/i18n/provider';
import en from '../../messages/en.json';

describe('EncryptionDisabledNotice', () => {
  afterEach(cleanup);

  it('names the env var and links to the admin docs', () => {
    render(
      <I18nProvider locale="en" messages={en}>
        <EncryptionDisabledNotice />
      </I18nProvider>,
    );
    expect(screen.getByText(/CAIRN_ENABLE_E2E_ENCRYPTION=true/)).toBeTruthy();
    expect(screen.getByText('End-to-end encryption is turned off in this build.')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Read the encryption admin guide' });
    expect(link.getAttribute('href')).toContain('e2e-encryption');
  });
});
