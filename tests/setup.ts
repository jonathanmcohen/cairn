import { vi } from 'vitest';

// getAuthContext() now reads/writes the `cairn_ws` cookie via next/headers.
// Outside a Next.js request scope (i.e. in unit/integration tests) `cookies()`
// throws. Provide a per-test in-memory cookie store so existing tests that drive
// getAuthContext through a faked session keep working. Tests that need to assert
// on specific cookie values still vi.doMock('next/headers') themselves, which
// takes precedence after vi.resetModules().
vi.mock('next/headers', () => {
  const store = new Map<string, string>();
  return {
    cookies: async () => ({
      get: (name: string) => {
        const value = store.get(name);
        return value === undefined ? undefined : { name, value };
      },
      set: (name: string, value: string) => {
        store.set(name, value);
      },
    }),
  };
});
