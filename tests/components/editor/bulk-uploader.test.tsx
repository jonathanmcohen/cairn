// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BulkUploader } from '@/components/editor/bulk-uploader';

function makeFile(name: string, type: string): File {
  return new File(['x'], name, { type });
}

let inflight = 0;
let peakInflight = 0;

beforeEach(() => {
  inflight = 0;
  peakInflight = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, _init?: RequestInit) => {
      inflight += 1;
      peakInflight = Math.max(peakInflight, inflight);
      await new Promise((r) => setTimeout(r, 20));
      inflight -= 1;
      return new Response(
        JSON.stringify({ file: { id: `file-${Math.random().toString(36).slice(2)}` } }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BulkUploader', () => {
  it('shows a row per file with initial pending status', () => {
    const files = [makeFile('a.png', 'image/png'), makeFile('b.pdf', 'application/pdf')];
    render(<BulkUploader open files={files} onOpenChange={() => {}} onComplete={() => {}} />);
    expect(screen.getByText('a.png')).toBeTruthy();
    expect(screen.getByText('b.pdf')).toBeTruthy();
  });

  it('caps parallel uploads at 4', async () => {
    const files = Array.from({ length: 10 }, (_, i) => makeFile(`f${i}.mp3`, 'audio/mpeg'));
    render(<BulkUploader open files={files} onOpenChange={() => {}} onComplete={() => {}} />);
    await waitFor(() => expect(peakInflight).toBeGreaterThan(0));
    await waitFor(() => expect(inflight).toBe(0), { timeout: 3000 });
    expect(peakInflight).toBeLessThanOrEqual(4);
  });

  it('calls onComplete with one result per file', async () => {
    const onComplete = vi.fn();
    const files = [
      makeFile('a.png', 'image/png'),
      makeFile('b.mp3', 'audio/mpeg'),
      makeFile('c.mp4', 'video/mp4'),
    ];
    render(<BulkUploader open files={files} onOpenChange={() => {}} onComplete={onComplete} />);
    await waitFor(() => expect(onComplete).toHaveBeenCalled(), { timeout: 3000 });
    const results = onComplete.mock.calls[0]![0] as { name: string; kind: string }[];
    expect(results).toHaveLength(3);
    expect(results.find((r) => r.name === 'a.png')?.kind).toBe('image');
    expect(results.find((r) => r.name === 'b.mp3')?.kind).toBe('audio');
    expect(results.find((r) => r.name === 'c.mp4')?.kind).toBe('video');
  });

  it('marks failed uploads without blocking remaining files', async () => {
    let callCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        callCount += 1;
        if (callCount === 1) return new Response('boom', { status: 500 });
        return new Response(JSON.stringify({ file: { id: 'ok' } }), { status: 200 });
      }),
    );
    const onComplete = vi.fn();
    const files = [makeFile('bad.png', 'image/png'), makeFile('good.png', 'image/png')];
    render(<BulkUploader open files={files} onOpenChange={() => {}} onComplete={onComplete} />);
    await waitFor(() => expect(onComplete).toHaveBeenCalled(), { timeout: 3000 });
    const results = onComplete.mock.calls[0]![0] as { name: string; status: string }[];
    expect(results.find((r) => r.name === 'bad.png')?.status).toBe('failed');
    expect(results.find((r) => r.name === 'good.png')?.status).toBe('done');
  });
});
