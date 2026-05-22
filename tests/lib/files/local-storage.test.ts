import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe } from 'vitest';
import { LocalDiskStorage } from '@/lib/files/storage';
import { runFileStorageContract } from './storage-contract';

describe('LocalDiskStorage', () => {
  runFileStorageContract(async () => new LocalDiskStorage(await mkdtemp(join(tmpdir(), 'cairn-'))));
});
