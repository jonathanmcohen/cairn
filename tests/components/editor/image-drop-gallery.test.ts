// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { composeGalleryInsert } from '@/components/editor/image-extension';

describe('composeGalleryInsert', () => {
  it('returns a single cairnImage node for 1 file (back-compat)', async () => {
    const uploadFn = vi.fn().mockImplementation(async (f: File) => ({
      fileId: `id-${f.name}`,
      src: `/api/files/id-${f.name}`,
      alt: f.name,
    }));
    const result = await composeGalleryInsert({
      files: [new File(['1'], 'a.png', { type: 'image/png' })],
      uploadFn,
    });
    expect(result.type).toBe('cairnImage');
    if (result.type !== 'cairnImage') throw new Error('expected cairnImage');
    expect(result.attrs.fileId).toBe('id-a.png');
    expect(result.attrs.src).toBe('/api/files/id-a.png');
    expect(uploadFn).toHaveBeenCalledTimes(1);
  });

  it('returns one gallery node containing N cairnImage children for N>=2 files', async () => {
    const uploadFn = vi.fn().mockImplementation(async (f: File) => ({
      fileId: `id-${f.name}`,
      src: `/api/files/id-${f.name}`,
      alt: f.name,
    }));
    const result = await composeGalleryInsert({
      files: [
        new File(['1'], 'a.png', { type: 'image/png' }),
        new File(['2'], 'b.png', { type: 'image/png' }),
        new File(['3'], 'c.png', { type: 'image/png' }),
      ],
      uploadFn,
    });
    expect(result.type).toBe('gallery');
    if (result.type !== 'gallery') throw new Error('expected gallery');
    expect(result.content).toHaveLength(3);
    expect(result.content[0]?.type).toBe('cairnImage');
    expect(result.content[0]?.attrs.fileId).toBe('id-a.png');
    expect(result.content[2]?.attrs.fileId).toBe('id-c.png');
  });

  it('filters out non-image files', async () => {
    const uploadFn = vi.fn().mockImplementation(async (f: File) => ({
      fileId: `id-${f.name}`,
      src: `/api/files/id-${f.name}`,
      alt: f.name,
    }));
    const result = await composeGalleryInsert({
      files: [
        new File(['1'], 'a.png', { type: 'image/png' }),
        new File(['2'], 'b.txt', { type: 'text/plain' }),
        new File(['3'], 'c.jpg', { type: 'image/jpeg' }),
      ],
      uploadFn,
    });
    expect(result.type).toBe('gallery');
    if (result.type !== 'gallery') throw new Error('expected gallery');
    expect(result.content).toHaveLength(2);
    expect(uploadFn).toHaveBeenCalledTimes(2);
  });

  it('returns an empty gallery for zero image files (caller skips insert)', async () => {
    const uploadFn = vi.fn();
    const result = await composeGalleryInsert({
      files: [new File(['1'], 'a.txt', { type: 'text/plain' })],
      uploadFn,
    });
    expect(result.type).toBe('gallery');
    if (result.type !== 'gallery') throw new Error('expected gallery');
    expect(result.content).toHaveLength(0);
    expect(uploadFn).not.toHaveBeenCalled();
  });
});
