import type * as schema from '@/db/schema';
import type { ConnectorAdapter } from './adapter';

const adapters = new Map<schema.ConnectorKind, ConnectorAdapter>();

export class UnknownAdapterError extends Error {
  constructor(kind: string) {
    super(`no adapter registered for kind '${kind}'`);
    this.name = 'UnknownAdapterError';
  }
}

export function register(adapter: ConnectorAdapter): void {
  adapters.set(adapter.kind, adapter);
}

export function getAdapter(kind: schema.ConnectorKind): ConnectorAdapter {
  const a = adapters.get(kind);
  if (!a) throw new UnknownAdapterError(kind);
  return a;
}

/** Test-only: forget all registered adapters. */
export function __resetRegistry(): void {
  adapters.clear();
}
