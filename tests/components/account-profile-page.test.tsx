// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock('@/lib/i18n/provider', async () => {
  const en = (await import('@/../messages/en.json')).default as Record<string, string>;
  return { useT: () => (key: string) => en[key] ?? key };
});

import { ProfileForm } from '@/components/account/profile-form';

afterEach(cleanup);

const pageSource = readFileSync(
  path.resolve(__dirname, '../../src/app/(app)/settings/account/profile/page.tsx'),
  'utf8',
);

describe('#126 Display name label is rendered exactly once', () => {
  it('the page no longer hard-codes a "Display name" <dt>', () => {
    expect(pageSource).not.toContain('>Display name<');
    expect(pageSource).not.toMatch(/<dt[^>]*>Display name<\/dt>/);
  });

  it('the kept accessible label comes from ProfileForm and is bound to the input', () => {
    render(<ProfileForm initialName="x" />);
    const labels = screen.getAllByText('Display name');
    expect(labels).toHaveLength(1);
    // The label is the input's accessible name (htmlFor binding intact).
    expect(screen.getByLabelText('Display name')).toBeTruthy();
  });
});
