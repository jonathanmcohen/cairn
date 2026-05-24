import { vi } from 'vitest';

// v0.7.0 G4 P12: the on-write embedding hook in src/lib/pages/{create,update}.ts
// fires a setImmediate that ultimately runs embedPage against the same db
// reference the caller used. In integration tests, this background work can
// race with the next test's TRUNCATE (deadlock) and tries to use the db after
// the suite has closed it. Disable by default for the whole test suite; the
// targeted on-write hook test (tests/lib/pages/update-embeds.test.ts) re-enables
// it explicitly with vi.doMock + delete process.env.CAIRN_DISABLE_EMBED_HOOK.
process.env.CAIRN_DISABLE_EMBED_HOOK = '1';

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
