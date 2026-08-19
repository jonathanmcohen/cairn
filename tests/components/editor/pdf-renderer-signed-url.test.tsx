// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn(() => ({
    promise: Promise.resolve({ numPages: 0, getPage: () => Promise.resolve({}) }),
  })),
}));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker.js' }));

import * as pdfjs from 'pdfjs-dist';
import PdfRenderer from '@/components/editor/extensions/pdf-renderer';

afterEach(() => cleanup());

describe('PdfRenderer signed-url flow', () => {
  it('fetches /api/files/[id]/signed-url then hands the URL to pdfjs.getDocument', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/signed-url')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ url: 'https://signed/example.pdf' }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ annotations: [] }) });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<PdfRenderer fileId="abc" defaultPage={1} pageId="p1" />);
    await waitFor(() => {
      // pdfjs-dist v6 takes DocumentInitParameters, not a bare URL string.
      expect(pdfjs.getDocument as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledWith({
        url: 'https://signed/example.pdf',
      });
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/files/abc/signed-url');
    expect(fetchMock).toHaveBeenCalledWith('/api/pdf/abc/annotations');
  });
});
