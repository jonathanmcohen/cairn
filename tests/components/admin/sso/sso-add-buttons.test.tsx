// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { IdpAddButtons } from '@/components/admin/sso/idp-add-buttons';

afterEach(cleanup);

describe('IdpAddButtons (#191)', () => {
  it('renders both Add links with the same outline variant', () => {
    render(<IdpAddButtons />);
    const oidc = screen.getByRole('link', { name: 'Add OIDC' });
    const saml = screen.getByRole('link', { name: 'Add SAML' });
    // shadcn outline variant => border + bg-background; default => bg-primary
    expect(oidc.className).toBe(saml.className);
    expect(oidc.className).not.toContain('bg-primary');
    expect(oidc.className).toContain('border');
  });
});
