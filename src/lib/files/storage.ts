import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import type { Readable } from 'node:stream';

export interface FileStorage {
  put(path: string, body: Buffer, mimeType: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;
  read(path: string): Readable;
}

export class LocalDiskStorage implements FileStorage {
  constructor(private readonly root: string) {}

  private resolve(p: string): string {
    if (isAbsolute(p) || p.includes('..')) throw new Error('invalid path');
    const normalized = normalize(p);
    if (normalized.startsWith('..')) throw new Error('invalid path');
    return join(this.root, normalized);
  }

  async put(path: string, body: Buffer, _mime: string): Promise<void> {
    const full = this.resolve(path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await stat(this.resolve(path));
      return true;
    } catch {
      return false;
    }
  }

  async delete(path: string): Promise<void> {
    await rm(this.resolve(path), { force: true });
  }

  read(path: string): Readable {
    return createReadStream(this.resolve(path));
  }
}
