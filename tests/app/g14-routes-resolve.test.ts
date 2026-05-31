import { describe, expect, it } from 'vitest';

const NEW_PAGES = ['@/app/(app)/search/page', '@/app/(app)/favorites/page'] as const;

describe('G14 new routes resolve', () => {
  for (const mod of NEW_PAGES) {
    it(`${mod} exports a default page component`, async () => {
      const imported = (await import(mod)) as { default?: unknown };
      expect(typeof imported.default).toBe('function');
    });
  }
});
