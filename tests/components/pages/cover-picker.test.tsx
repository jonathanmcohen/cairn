// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoverPicker } from '@/components/pages/cover-picker';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(cleanup);

function wrap(ui: React.ReactNode) {
  return (
    <I18nProvider locale="en" messages={enMessages}>
      {ui}
    </I18nProvider>
  );
}

describe('<CoverPicker> URL tab (#108)', () => {
  beforeEach(() => {
    global.fetch = vi.fn(
      async () => new Response(null, { status: 200 }),
    ) as unknown as typeof fetch;
  });

  it('saves a pasted https image URL as an unsplash-kind cover', async () => {
    const onChange = vi.fn();
    render(wrap(<CoverPicker pageId="p1" current={{}} onChange={onChange} />));
    fireEvent.click(screen.getByRole('button', { name: enMessages['cover.add'] }));
    fireEvent.click(screen.getByRole('tab', { name: enMessages['cover.tab.url'] }));
    const input = screen.getByLabelText(enMessages['cover.urlLabel']);
    fireEvent.change(input, { target: { value: 'https://example.com/pic.jpg' } });
    fireEvent.click(screen.getByRole('button', { name: enMessages['cover.use'] }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        kind: 'unsplash',
        value: 'https://example.com/pic.jpg',
      }),
    );
  });

  it('does not save a non-https URL', () => {
    const onChange = vi.fn();
    render(wrap(<CoverPicker pageId="p1" current={{}} onChange={onChange} />));
    fireEvent.click(screen.getByRole('button', { name: enMessages['cover.add'] }));
    fireEvent.click(screen.getByRole('tab', { name: enMessages['cover.tab.url'] }));
    fireEvent.change(screen.getByLabelText(enMessages['cover.urlLabel']), {
      target: { value: 'http://insecure.example/pic.jpg' },
    });
    fireEvent.click(screen.getByRole('button', { name: enMessages['cover.use'] }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
