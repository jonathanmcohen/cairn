// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import enMessages from '@/../messages/en.json';
import { ListView } from '@/components/databases/list-view';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(cleanup);

const meta = { properties: [{ id: 'p1', name: 'Name', type: 'text', config: {} }] } as never;
const view = { id: 'v1', config: {} } as never;

describe('<ListView> polish', () => {
  it('shows the shared empty state when there are no rows', () => {
    render(
      <I18nProvider locale="en" messages={enMessages}>
        <ListView databaseId="d1" meta={meta} rows={[]} view={view} onChange={() => {}} />
      </I18nProvider>,
    );
    expect(screen.getByText('No rows yet.')).toBeTruthy();
  });

  it('has no text-[10px] footer trigger', () => {
    const { container } = render(
      <I18nProvider locale="en" messages={enMessages}>
        <ListView databaseId="d1" meta={meta} rows={[]} view={view} onChange={() => {}} />
      </I18nProvider>,
    );
    expect(container.querySelector('[class*="text-[10px]"]')).toBeNull();
  });
});
