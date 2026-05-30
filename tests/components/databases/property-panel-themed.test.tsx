// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PropertyPanel } from '@/components/databases/property-panel';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.spyOn(global, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ databases: [], properties: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
});

describe('<PropertyPanel> themed selects (#38)', () => {
  it('has no native <select> once the add-property form is open', () => {
    const { container } = render(
      <I18nProvider locale="en" messages={enMessages}>
        <PropertyPanel databaseId="db1" onChange={() => {}} />
      </I18nProvider>,
    );
    // open the add-property form
    fireEvent.click(screen.getByRole('button', { name: /add property/i }));
    expect(container.querySelector('select')).toBeNull();
    expect(screen.getByRole('combobox', { name: /property type/i })).toBeTruthy();
  });
});
