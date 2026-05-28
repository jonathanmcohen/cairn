// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ExportStaticSiteForm } from '@/app/(app)/settings/workspace/export-static-site/export-static-site-form';

afterEach(() => {
  cleanup();
});

describe('ExportStaticSiteForm', () => {
  it('lists both mkdocs and docusaurus as selectable targets', () => {
    render(<ExportStaticSiteForm workspaceId="00000000-0000-4000-8000-000000000000" />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toContain('mkdocs');
    expect(optionValues).toContain('docusaurus');
  });
});
