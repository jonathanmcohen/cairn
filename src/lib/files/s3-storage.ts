import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { FileStorage } from './storage';

export type S3StorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
};

export class S3Storage implements FileStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(cfg: S3StorageConfig) {
    this.bucket = cfg.bucket;
    this.client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      forcePathStyle: true, // required for MinIO + path-style buckets
      credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
    });
  }

  async put(path: string, body: Buffer, mimeType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: path, Body: body, ContentType: mimeType }),
    );
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: path }));
      return true;
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === 'NotFound' || name === 'NoSuchKey') return false;
      throw err;
    }
  }

  async delete(path: string): Promise<void> {
    // S3 DeleteObject is idempotent — succeeds even when the key is absent.
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: path }));
  }

  read(path: string): Readable {
    // The handler streams this into the response. We adapt the async GetObject
    // body into a Readable via a PassThrough so the signature stays sync, matching
    // LocalDiskStorage.read(): Readable.
    const pass = new Readable({ read() {} });
    this.client
      .send(new GetObjectCommand({ Bucket: this.bucket, Key: path }))
      .then((res) => {
        const body = res.Body as Readable;
        body.on('data', (c) => pass.push(c));
        body.on('end', () => pass.push(null));
        body.on('error', (e) => pass.destroy(e));
      })
      .catch((e) => pass.destroy(e as Error));
    return pass;
  }
}
