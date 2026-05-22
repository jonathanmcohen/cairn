import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe } from 'vitest';
import { S3Storage } from '@/lib/files/s3-storage';
import { runFileStorageContract } from './storage-contract';

describe('S3Storage (MinIO)', () => {
  let container: StartedTestContainer;
  let storage: S3Storage;

  beforeAll(async () => {
    container = await new GenericContainer('minio/minio:latest')
      .withCommand(['server', '/data'])
      .withEnvironment({ MINIO_ROOT_USER: 'minioadmin', MINIO_ROOT_PASSWORD: 'minioadmin' })
      .withExposedPorts(9000)
      .start();
    const endpoint = `http://${container.getHost()}:${container.getMappedPort(9000)}`;
    const cfg = {
      endpoint,
      region: 'us-east-1',
      bucket: 'cairn-test',
      accessKey: 'minioadmin',
      secretKey: 'minioadmin',
    };
    // create the bucket once
    const client = new S3Client({
      endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
    });
    await client.send(new CreateBucketCommand({ Bucket: 'cairn-test' }));
    storage = new S3Storage(cfg);
  }, 120_000);

  afterAll(async () => {
    await container?.stop();
  });

  runFileStorageContract(() => storage);
});
