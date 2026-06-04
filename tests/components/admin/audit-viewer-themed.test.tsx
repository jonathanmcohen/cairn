// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditViewer } from '@/components/admin/audit-viewer';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json' with { type: 'json' };

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.spyOn(global, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ entries: [], nextCursor: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
});

describe('<AuditViewer> themed filters (#38)', () => {
  it('renders themed Selects + DateFields and no native select/date inputs', async () => {
    const { container } = render(
      <I18nProvider locale="en" messages={enMessages}>
        <AuditViewer />
      </I18nProvider>,
    );
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container.querySelector('select')).toBeNull();
    expect(container.querySelector('input[type="date"]')).toBeNull();
    expect(screen.getByRole('combobox', { name: /^Action$/i })).toBeTruthy();
  });
});
