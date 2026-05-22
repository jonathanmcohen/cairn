import { expect, it } from 'vitest';
import type { FileStorage } from '@/lib/files/storage';

async function drain(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

/** Run the FileStorage contract against any implementation. */
export function runFileStorageContract(make: () => Promise<FileStorage> | FileStorage): void {
  it('round-trips put -> exists -> read', async () => {
    const s = await make();
    const path = `ws/${Date.now()}.txt`;
    expect(await s.exists(path)).toBe(false);
    await s.put(path, Buffer.from('hello cairn'), 'text/plain');
    expect(await s.exists(path)).toBe(true);
    expect((await drain(s.read(path))).toString()).toBe('hello cairn');
  });

  it('delete removes the object and is idempotent', async () => {
    const s = await make();
    const path = `ws/${Date.now()}-del.bin`;
    await s.put(path, Buffer.from([1, 2, 3]), 'application/octet-stream');
    await s.delete(path);
    expect(await s.exists(path)).toBe(false);
    await s.delete(path); // no throw on missing
    expect(await s.exists(path)).toBe(false);
  });
}
