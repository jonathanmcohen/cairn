import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalDiskStorage } from '@/lib/files/storage';

let root = '';
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'cairn-test-'));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('LocalDiskStorage', () => {
  it('writes a blob and reads it back', async () => {
    const store = new LocalDiskStorage(root);
    const buf = Buffer.from('hello');
    await store.put('ws/abc.txt', buf, 'text/plain');
    const round = await readFile(join(root, 'ws/abc.txt'));
    expect(round.toString()).toBe('hello');
  });

  it('exists() reports true after put, false otherwise', async () => {
    const store = new LocalDiskStorage(root);
    expect(await store.exists('ws/missing.txt')).toBe(false);
    await store.put('ws/exists.txt', Buffer.from('x'), 'text/plain');
    expect(await store.exists('ws/exists.txt')).toBe(true);
  });

  it('delete() removes the file', async () => {
    const store = new LocalDiskStorage(root);
    await store.put('ws/gone.txt', Buffer.from('x'), 'text/plain');
    await store.delete('ws/gone.txt');
    expect(await store.exists('ws/gone.txt')).toBe(false);
  });

  it('rejects path traversal', async () => {
    const store = new LocalDiskStorage(root);
    await expect(store.put('../escape.txt', Buffer.from('x'), 'text/plain')).rejects.toThrow(
      /invalid path/i,
    );
  });
});
