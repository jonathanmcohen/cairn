import { describe, expect, it } from 'vitest';

// Regression: the flashcards study page must live under the `(app)` route group
// so it inherits the app shell (sidebar/top bar, OfflineProvider, LiveRegion,
// ShortcutDispatcher) and the auth/2FA enforcement from `(app)/layout.tsx`.
// It previously lived at `src/app/flashcards/study/page.tsx` (no shell → blank).
describe('flashcards study route', () => {
  it('resolves under the (app) route group and exports a default page component', async () => {
    const imported = (await import('@/app/(app)/flashcards/study/page')) as {
      default?: unknown;
    };
    expect(typeof imported.default).toBe('function');
  });
});
