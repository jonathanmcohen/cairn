import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock next/headers — publicOrigin reads the incoming request host through it.
const headerStore = new Map<string, string>();
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (k: string) => headerStore.get(k.toLowerCase()) ?? null }),
}));

import { publicOrigin } from '@/lib/url';

const ORIG = { ...process.env };

beforeEach(() => {
  headerStore.clear();
  delete process.env.PUBLIC_URL;
  delete process.env.NEXTAUTH_URL;
});
afterEach(() => {
  process.env = { ...ORIG };
});

describe('publicOrigin', () => {
  it('prefers an explicit non-empty PUBLIC_URL (no trailing slash)', async () => {
    process.env.PUBLIC_URL = 'https://cairn.example.com/';
    expect(await publicOrigin()).toBe('https://cairn.example.com');
  });

  it('falls back to the forwarded host (https) when PUBLIC_URL is unset — the #50 repro', async () => {
    // Bare compose: PUBLIC_URL not in container, NEXTAUTH_URL is the localhost build-default.
    process.env.NEXTAUTH_URL = 'http://localhost:3000';
    headerStore.set('x-forwarded-host', 'cairn.local.jonco.dev');
    expect(await publicOrigin()).toBe('https://cairn.local.jonco.dev');
  });

  it('honours X-Forwarded-Proto when present', async () => {
    headerStore.set('x-forwarded-host', 'cairn.local.jonco.dev');
    headerStore.set('x-forwarded-proto', 'http');
    expect(await publicOrigin()).toBe('http://cairn.local.jonco.dev');
  });

  it('uses the plain Host header when no forwarded host is set', async () => {
    headerStore.set('host', 'box.lan:3000');
    expect(await publicOrigin()).toBe('http://box.lan:3000');
  });

  it('prefers a real external NEXTAUTH_URL over the request host', async () => {
    process.env.NEXTAUTH_URL = 'https://canonical.example.com';
    headerStore.set('x-forwarded-host', 'internal-lb.local');
    expect(await publicOrigin()).toBe('https://canonical.example.com');
  });

  it('last-resorts to localhost only when nothing else is available', async () => {
    expect(await publicOrigin()).toBe('http://localhost:3000');
  });
});
