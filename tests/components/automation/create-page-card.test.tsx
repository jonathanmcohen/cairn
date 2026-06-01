// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CreatePageCard } from '@/components/automation/builder/create-page-card';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockApis() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/api/templates')) {
      return new Response(JSON.stringify({ templates: [{ id: 't1', name: 'Meeting' }] }), {
        status: 200,
      });
    }
    if (url.includes('/api/pages/tree')) {
      return new Response(JSON.stringify({ nodes: [{ id: 'pg1', title: 'Docs' }] }), {
        status: 200,
      });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  });
}

function renderCard(config: Record<string, unknown>, onChange = vi.fn()) {
  return render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      <CreatePageCard config={config} onChange={onChange} />
    </I18nProvider>,
  );
}

it('renders the template + parent selects (no raw <select>)', async () => {
  mockApis();
  const { container } = renderCard({});
  await waitFor(() => expect(screen.getByText('Parent page (optional)')).toBeTruthy());
  expect(container.querySelector('select')).toBeNull();
});

it('typing a title template emits { titleTemplate }', async () => {
  mockApis();
  const onChange = vi.fn();
  renderCard({}, onChange);
  await waitFor(() => expect(screen.getAllByText('Template').length).toBeGreaterThan(0));
  const inputs = document.querySelectorAll('input');
  const titleInput = inputs[inputs.length - 1];
  if (!titleInput) throw new Error('no title input');
  fireEvent.change(titleInput, { target: { value: 'Weekly {{page.title}}' } });
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({ titleTemplate: 'Weekly {{page.title}}' }),
  );
});
