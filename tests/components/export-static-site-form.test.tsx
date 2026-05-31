// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ExportStaticSiteForm } from '@/app/(app)/settings/workspace/export-static-site/export-static-site-form';

// jsdom lacks the layout APIs radix Select calls on open.
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};

afterEach(() => {
  cleanup();
});

describe('ExportStaticSiteForm', () => {
  it('lists both mkdocs and docusaurus as selectable targets', async () => {
    render(<ExportStaticSiteForm workspaceId="00000000-0000-4000-8000-000000000000" />);
    const trigger = screen.getByRole('combobox', { name: 'Target' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(await screen.findByRole('option', { name: 'MkDocs (Material)' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Docusaurus' })).toBeTruthy();
  });
});
