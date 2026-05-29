// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiKeysManager } from '@/components/settings/api-keys-manager';

afterEach(cleanup);

describe('<ApiKeysManager> "Create key" button (#34)', () => {
  // #34 (reopened): the button must stay a 44px primary button. The visible
  // defect (a near-white pill in dark mode) was a token bug — the default
  // accent never bound --primary — fixed in globals.css. This guards the
  // variant so a future refactor can't silently downgrade it.
  it('renders "Create key" as a 44px primary button', () => {
    render(<ApiKeysManager initialKeys={[]} />);
    const btn = screen.getByRole('button', { name: /create key/i });
    expect(btn.className).toMatch(/bg-primary/);
    expect(btn.className).toMatch(/min-h-11/);
  });
});
