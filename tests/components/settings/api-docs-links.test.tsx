// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiDocsLinks } from '@/components/settings/api-docs-links';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json' with { type: 'json' };

afterEach(cleanup);

describe('<ApiDocsLinks>', () => {
  it('links to the Swagger UI and the OpenAPI download', () => {
    render(
      <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
        <ApiDocsLinks />
      </I18nProvider>,
    );
    const swagger = screen.getByRole('link', { name: 'API reference (Swagger)' });
    expect(swagger.getAttribute('href')).toBe('/api-docs');
    const download = screen.getByRole('link', { name: 'Download OpenAPI spec' });
    expect(download.getAttribute('href')).toBe('/openapi.json');
    expect(download.getAttribute('download')).not.toBeNull();
  });
});
