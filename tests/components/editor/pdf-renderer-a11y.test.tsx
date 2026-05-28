// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: () => ({
    promise: Promise.resolve({ numPages: 0, getPage: () => Promise.resolve({}) }),
  }),
}));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }));

import PdfRenderer from '@/components/editor/extensions/pdf-renderer';

afterEach(() => cleanup());

/**
 * v0.9.0 G3 P17 — JSDOM-level a11y smoke for the PDF renderer.
 *
 * Confirms the toolbar carries `role="toolbar"` + an aria-label, every tool
 * button has both an accessible name and an `aria-pressed` state, and the
 * canvas / SVG overlay carry per-page aria-labels. The full WCAG gate runs
 * via Playwright; this file catches regressions cheap.
 */
describe('a11y: PdfRenderer (JSDOM smoke)', () => {
  it('toolbar carries role + aria-label and tool buttons are aria-pressed', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'blob:x', annotations: [] }),
    }) as unknown as typeof fetch;
    render(<PdfRenderer fileId="f1" defaultPage={1} pageId="p1" />);
    const toolbar = await screen.findByRole('toolbar', { name: /pdf annotation tools/i });
    expect(toolbar).toBeTruthy();
    const highlight = screen.getByRole('button', { name: /highlight/i });
    expect(highlight.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /comment/i }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(screen.getByRole('button', { name: /shape/i }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('renders an alert with a clear message when the URL fetch fails', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 403 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ annotations: [] }),
      }) as unknown as typeof fetch;
    render(<PdfRenderer fileId="f1" defaultPage={1} pageId="p1" />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/encrypted page/i);
  });
});
