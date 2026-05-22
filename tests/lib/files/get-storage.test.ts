import { afterEach, describe, expect, it } from 'vitest';
import { LocalDiskStorage } from '@/lib/files/storage';

describe('getStorage factory', () => {
  const orig = { ...process.env };
  afterEach(() => {
    process.env = { ...orig };
  });

  it('defaults to LocalDiskStorage', async () => {
    process.env.FILE_BACKEND = undefined;
    const { getStorage, __resetStorage } = await import('@/lib/files/get-storage');
    __resetStorage();
    expect(getStorage()).toBeInstanceOf(LocalDiskStorage);
  });

  it('returns an S3Storage when FILE_BACKEND=s3', async () => {
    process.env.FILE_BACKEND = 's3';
    process.env.S3_ENDPOINT = 'http://localhost:9000';
    process.env.S3_BUCKET = 'cairn';
    process.env.S3_ACCESS_KEY = 'a';
    process.env.S3_SECRET_KEY = 'b';
    process.env.S3_REGION = 'us-east-1';
    const { getStorage, __resetStorage } = await import('@/lib/files/get-storage');
    const { S3Storage } = await import('@/lib/files/s3-storage');
    __resetStorage();
    expect(getStorage()).toBeInstanceOf(S3Storage);
  });
});
