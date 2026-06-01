// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import enMessages from '@/../messages/en.json';
import { GalleryView } from '@/components/databases/gallery-view';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(cleanup);

const meta = { properties: [{ id: 'p1', name: 'Name', type: 'text', config: {} }] } as never;
const view = { id: 'v1', config: {} } as never;

describe('<GalleryView> empty state', () => {
  it('renders the shared empty-state headline + guidance', () => {
    render(
      <I18nProvider locale="en" messages={enMessages}>
        <GalleryView databaseId="d1" meta={meta} rows={[]} view={view} onChange={() => {}} />
      </I18nProvider>,
    );
    expect(screen.getByText('No rows yet')).toBeTruthy();
    expect(screen.getByText(/will appear here as a card/)).toBeTruthy();
  });
});
