// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoverPicker } from '@/components/pages/cover-picker';
import { I18nProvider } from '@/lib/i18n/provider';
import { COVER_PRESETS } from '@/lib/pages/cover-presets';
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

describe('<CoverPicker> presets + contrast (findings U + Y)', () => {
  beforeEach(() => {
    global.fetch = vi.fn(
      async () => new Response(null, { status: 200 }),
    ) as unknown as typeof fetch;
  });

  it('saves a gradient preset as a preset-kind cover', async () => {
    const onChange = vi.fn();
    render(wrap(<CoverPicker pageId="p1" current={{}} onChange={onChange} />));
    fireEvent.click(screen.getByRole('button', { name: enMessages['cover.add'] }));
    fireEvent.click(
      screen.getByRole('button', {
        name: enMessages['cover.usePreset'].replace('{name}', enMessages['cover.preset.slateDusk']),
      }),
    );
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ kind: 'preset', value: 'slate-dusk' }),
    );
  });

  it('does NOT render the old solid-orange hex swatch', () => {
    render(wrap(<CoverPicker pageId="p1" current={{}} onChange={vi.fn()} />));
    fireEvent.click(screen.getByRole('button', { name: enMessages['cover.add'] }));
    // The previous default #ea580c swatch must be gone.
    expect(
      screen.queryByLabelText(enMessages['cover.useColor'].replace('{hex}', '#ea580c')),
    ).toBeNull();
  });

  it('shows a contrast warning for a low-contrast custom hex and hides it for a safe one', () => {
    render(wrap(<CoverPicker pageId="p1" current={{}} onChange={vi.fn()} />));
    fireEvent.click(screen.getByRole('button', { name: enMessages['cover.add'] }));
    const input = screen.getByLabelText(enMessages['cover.customHex']);
    fireEvent.change(input, { target: { value: '#ea580c' } });
    expect(screen.getByText(enMessages['cover.contrastWarning'])).toBeTruthy();
    fireEvent.change(input, { target: { value: '#0f172a' } });
    expect(screen.queryByText(enMessages['cover.contrastWarning'])).toBeNull();
  });

  it('applies the default preset cover from the empty-state trigger', async () => {
    const onChange = vi.fn();
    render(wrap(<CoverPicker pageId="p1" current={{}} onChange={onChange} />));
    fireEvent.click(screen.getByRole('button', { name: enMessages['cover.add'] }));
    fireEvent.click(screen.getByRole('button', { name: enMessages['cover.useDefault'] }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ kind: 'preset', value: 'slate-dusk' }),
    );
  });
});

describe('<CoverPicker> layout polish (Plan M)', () => {
  beforeEach(() => {
    global.fetch = vi.fn(
      async () => new Response(null, { status: 200 }),
    ) as unknown as typeof fetch;
  });

  it('renders "Use default" as a secondary text-link, not a full-width primary CTA (#228)', () => {
    render(wrap(<CoverPicker pageId="p1" current={{}} />));
    fireEvent.click(screen.getByRole('button', { name: enMessages['cover.add'] }));
    const useDefault = screen.getByRole('button', { name: enMessages['cover.useDefault'] });
    // Demoted: link variant, not the primary/full-width CTA it used to be.
    expect(useDefault.className).not.toContain('w-full');
    expect(useDefault.className).toContain('text-muted-foreground');
    // It now lives at the bottom of the tab, after the gradient swatches.
    const firstGradient = screen.getByRole('button', {
      name: enMessages['cover.usePreset'].replace('{name}', enMessages['cover.preset.slateDusk']),
    });
    expect(
      firstGradient.compareDocumentPosition(useDefault) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('lays gradient swatches out in a 4-wide grid (#229)', () => {
    render(wrap(<CoverPicker pageId="p1" current={{}} />));
    fireEvent.click(screen.getByRole('button', { name: enMessages['cover.add'] }));
    const firstGradient = screen.getByRole('button', {
      name: enMessages['cover.usePreset'].replace('{name}', enMessages['cover.preset.slateDusk']),
    });
    const grid = firstGradient.parentElement as HTMLElement;
    expect(grid.className).toContain('grid-cols-4');
    expect(grid.className).not.toContain('grid-cols-7');
    // All curated gradients are present (palette currently has 9).
    expect(grid.querySelectorAll('button')).toHaveLength(
      COVER_PRESETS.filter((p) => p.type === 'gradient').length,
    );
  });
});
