import { S3Storage } from './s3-storage';
import type { FileStorage } from './storage';
import { LocalDiskStorage } from './storage';

let cached: FileStorage | null = null;

export function getStorage(): FileStorage {
  if (cached) return cached;
  const backend = process.env.FILE_BACKEND ?? 'local';
  if (backend === 's3') {
    const required = [
      'S3_ENDPOINT',
      'S3_BUCKET',
      'S3_ACCESS_KEY',
      'S3_SECRET_KEY',
      'S3_REGION',
    ] as const;
    for (const key of required) {
      if (!process.env[key]) throw new Error(`FILE_BACKEND=s3 requires ${key}`);
    }
    cached = new S3Storage({
      endpoint: process.env.S3_ENDPOINT as string,
      bucket: process.env.S3_BUCKET as string,
      accessKey: process.env.S3_ACCESS_KEY as string,
      secretKey: process.env.S3_SECRET_KEY as string,
      region: process.env.S3_REGION as string,
    });
  } else {
    const root = process.env.CAIRN_UPLOAD_ROOT ?? '/data/uploads';
    cached = new LocalDiskStorage(root);
  }
  return cached;
}

/** Test-only: clear the memoized backend so env changes take effect. */
export function __resetStorage(): void {
  cached = null;
}
