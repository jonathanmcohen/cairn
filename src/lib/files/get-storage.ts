import { LocalDiskStorage } from './storage';
import type { FileStorage } from './storage';

let cached: FileStorage | null = null;

export function getStorage(): FileStorage {
  if (!cached) {
    const root = process.env.CAIRN_UPLOAD_ROOT ?? '/data/uploads';
    cached = new LocalDiskStorage(root);
  }
  return cached;
}
