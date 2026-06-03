// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PageExportMenu } from '@/components/pages/export-menu';
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

describe('<PageExportMenu>', () => {
  it('opens a menu with six icon-bearing export items pointing at the export route', () => {
    render(wrap(<PageExportMenu pageId="p1" />));
    const trigger = screen.getByRole('button', { name: enMessages['pageActions.export.trigger'] });
    // Radix DropdownMenu opens on keyboard activation (it ignores synthetic
    // click in jsdom because it gates on pointer events).
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });

    const items = screen.getAllByRole('menuitem');
    expect(items.length).toBe(6);
    for (const item of items) {
      expect(item.querySelector('svg')).toBeTruthy();
    }

    const md = items.find((el) => el.getAttribute('href')?.endsWith('format=md'));
    const json = items.find((el) => el.getAttribute('href')?.includes('format=json'));
    const pdf = items.find((el) => el.getAttribute('href')?.includes('format=pdf'));
    expect(md?.getAttribute('href')).toBe('/api/pages/p1/export?format=md');
    expect(md?.hasAttribute('download')).toBe(true);
    expect(json?.getAttribute('href')).toBe('/api/pages/p1/export?format=json');
    expect(pdf?.getAttribute('href')).toBe('/api/pages/p1/export?format=pdf');
    expect(pdf?.getAttribute('target')).toBe('_blank');

    // #92 — the PDF item label is exactly "PDF", not "PDF (via browser print)".
    expect(pdf?.textContent?.trim()).toBe(enMessages['pageActions.export.pdf']);
    expect(enMessages['pageActions.export.pdf']).toBe('PDF');
  });

  it('renders all six export targets with correct hrefs (#56/#235)', () => {
    render(
      <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
        <PageExportMenu pageId="p1" open onOpenChange={() => {}} />
      </I18nProvider>,
    );
    const link = (name: string) => screen.getByRole('menuitem', { name }) as HTMLAnchorElement;
    expect(link(enMessages['pageActions.export.markdown']).getAttribute('href')).toBe(
      '/api/pages/p1/export?format=md',
    );
    expect(link(enMessages['pageActions.export.pdf']).getAttribute('href')).toBe(
      '/api/pages/p1/export?format=pdf',
    );
    expect(link(enMessages['pageActions.export.html']).getAttribute('href')).toBe(
      '/api/pages/p1/export?format=html',
    );
    expect(link(enMessages['pageActions.export.docx']).getAttribute('href')).toBe(
      '/api/pages/p1/export?format=docx',
    );
    expect(link(enMessages['pageActions.export.json']).getAttribute('href')).toBe(
      '/api/pages/p1/export?format=json',
    );
    expect(link(enMessages['pageActions.export.zip']).getAttribute('href')).toBe(
      '/api/pages/p1/export?recursive=true',
    );
  });
});
