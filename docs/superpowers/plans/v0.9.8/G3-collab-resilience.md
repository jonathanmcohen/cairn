# v0.9.8 G3 — Collab resilience (audit item I)

> **For agentic workers:** REQUIRED SUB-SKILL — read and follow `superpowers:test-driven-development` for every task in this plan. Write the failing test first, run it to confirm it fails for the right reason, write the minimal implementation, run it to green, then commit. Do not skip the run-to-fail step.

**Goal:** Make the collaborative editor resilient to transient collab-server / token-endpoint failures. Today the client (`src/components/editor/use-collab-doc.ts`) fetches a short-lived collab token once; if that fetch fails the status is set to `error` and the editor silently degrades to local-only edits with no recovery path (lines 44–46, 63–65). This group adds (1) an explicit exponential-backoff helper (base/max caps + jitter), (2) a token-fetch retry loop that recreates the `HocuspocusProvider` after a successful re-fetch, (3) a dismissible "Collab offline — reconnecting…" banner (distinct from the existing toolbar status pill at `editor.tsx:72–86,588–594`) surfaced on `disconnected`/`error` status with `aria-live="polite"`, fully i18n'd (en/es/ar), and (4) an ops-docs note that collab depends on resolvable `COLLAB_URL`/`PUBLIC_URL` DNS. No migration.

**Architecture:**
- Client collab hook: `src/components/editor/use-collab-doc.ts` — token fetch at line 43, provider construction at line 51, `onDisconnect` at line 60, terminal `error` set at lines 45 & 63. This hook returns `{ ydoc, provider, status, offlineReady }` and is consumed by `Editor` at `editor.tsx:112`.
- Status pill (DO NOT reuse — banner is distinct): `editor.tsx` `STATUS_LABEL`/`STATUS_DOT` maps (lines 72–86), rendered chip at lines 588–594.
- i18n: `useT()` from `src/lib/i18n/provider.tsx`; keys live in `messages/{en,es,ar}.json` (flat `Record<string,string>`); `t(key, params?)` interpolates `{name}`-style placeholders. `pnpm i18n:check` (`scripts/i18n-audit.ts`) must report no new untranslated keys.
- Backoff is a pure, dependency-injected helper (no `Date.now`/`Math.random` baked in) so the unit test is deterministic without `vi.useFakeTimers` for the math, and `vi.useFakeTimers` is used only for the scheduling-loop test.
- Ops docs: `README.md` already has a "Troubleshooting: collaboration won't connect" section (line 252); `docs/operations.md` documents the collab trust domain (line 421). Both get a DNS-resolvability note.
- Playwright a11y/e2e harness: `tests/a11y/*.spec.ts`, config `playwright.config.ts` (`testDir: ./tests/a11y`, `testMatch: **/*.spec.ts`). Fixtures `tests/a11y/fixtures.ts` expose `signIn(page, seeded)` + `seeded.pageId`. The harness boots a local Hocuspocus collab server (`A11Y_COLLAB_PORT`, default 11234) so the editor's provider actually connects.

**Tech Stack:** Next.js 16 (App Router, React 19), TypeScript 6 strict, Vitest 4 (+ Testcontainers, but this group's units need no DB), Biome v2, Tailwind v4 + shadcn/ui, `@hocuspocus/provider`, `yjs`, i18n via `useT()` (en/es/ar), Playwright for the banner e2e.

---

## Files

| Action | Path | Notes |
|--------|------|-------|
| Create | `src/components/editor/collab-backoff.ts` | Pure exponential-backoff helper (`computeBackoffDelay`) + defaults. |
| Create | `src/components/editor/collab-backoff.test.ts` | Vitest unit test for the backoff math + deterministic jitter + a fake-timer scheduling test. |
| Modify | `src/components/editor/use-collab-doc.ts` | Wrap token fetch in a retry loop using the backoff helper; recreate provider after a successful re-fetch; clear the timer on cleanup. |
| Create | `src/components/editor/collab-offline-banner.tsx` | Dismissible `aria-live="polite"` banner shown on `disconnected`/`error`. |
| Modify | `src/components/editor/editor.tsx` | Mount `<CollabOfflineBanner status={status} />` (import line ~14; render inside the top `relative` wrapper after `<EditorDialogs />`, line 542). |
| Modify | `messages/en.json` | Add `collab.offline.*` keys. |
| Modify | `messages/es.json` | Add `collab.offline.*` keys (Spanish). |
| Modify | `messages/ar.json` | Add `collab.offline.*` keys (Arabic). |
| Modify | `README.md` | DNS-resolvability note in the collab troubleshooting section (after line 277). |
| Modify | `docs/operations.md` | DNS-dependency note in the collab trust-domain section (after line 438). |
| Create | `tests/a11y/collab-offline.spec.ts` | Playwright: banner appears on simulated socket drop. |

---

## Task 1 — Pure exponential-backoff helper (`computeBackoffDelay`)

### Step 1.1 — Write the failing test

Create `src/components/editor/collab-backoff.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  type BackoffConfig,
  computeBackoffDelay,
  DEFAULT_COLLAB_BACKOFF,
  scheduleWithBackoff,
} from './collab-backoff';

// jitter() is injected so the math is deterministic. rand=0 => no jitter
// added; rand=1 => full jitter band added.
const CFG: BackoffConfig = { baseMs: 1000, maxMs: 30_000, factor: 2, jitterRatio: 0.5 };

describe('computeBackoffDelay', () => {
  it('grows exponentially from the base with no jitter (rand=0)', () => {
    expect(computeBackoffDelay(0, CFG, () => 0)).toBe(1000);
    expect(computeBackoffDelay(1, CFG, () => 0)).toBe(2000);
    expect(computeBackoffDelay(2, CFG, () => 0)).toBe(4000);
    expect(computeBackoffDelay(3, CFG, () => 0)).toBe(8000);
  });

  it('caps the exponential term at maxMs before jitter', () => {
    // attempt 10 => 1000 * 2^10 = 1_024_000, capped to 30_000.
    expect(computeBackoffDelay(10, CFG, () => 0)).toBe(30_000);
  });

  it('adds up to jitterRatio of the capped delay when rand=1', () => {
    // attempt 0: capped=1000, jitter band = 1000 * 0.5 = 500, full => 1500.
    expect(computeBackoffDelay(0, CFG, () => 1)).toBe(1500);
    // attempt 2: capped=4000, jitter band = 2000, full => 6000.
    expect(computeBackoffDelay(2, CFG, () => 1)).toBe(6000);
  });

  it('rounds to an integer millisecond', () => {
    // rand=0.333 => 1000 + (1000*0.5*0.333)=166.5 => rounds to 1167.
    expect(computeBackoffDelay(0, CFG, () => 0.333)).toBe(1167);
  });

  it('clamps negative attempt numbers to attempt 0', () => {
    expect(computeBackoffDelay(-5, CFG, () => 0)).toBe(1000);
  });

  it('exposes sane production defaults', () => {
    expect(DEFAULT_COLLAB_BACKOFF.baseMs).toBe(1000);
    expect(DEFAULT_COLLAB_BACKOFF.maxMs).toBe(30_000);
    expect(DEFAULT_COLLAB_BACKOFF.factor).toBe(2);
    expect(DEFAULT_COLLAB_BACKOFF.jitterRatio).toBeGreaterThan(0);
  });
});

describe('scheduleWithBackoff', () => {
  it('invokes the callback after the computed delay (fake timers)', () => {
    vi.useFakeTimers();
    try {
      const cb = vi.fn();
      // attempt 1, rand=0 => 2000ms with CFG.
      const cancel = scheduleWithBackoff(1, CFG, cb, () => 0);
      expect(cb).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1999);
      expect(cb).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(cb).toHaveBeenCalledTimes(1);
      cancel();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancel() prevents the callback from firing', () => {
    vi.useFakeTimers();
    try {
      const cb = vi.fn();
      const cancel = scheduleWithBackoff(0, CFG, cb, () => 0);
      cancel();
      vi.advanceTimersByTime(10_000);
      expect(cb).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
```

### Step 1.2 — Run the test to confirm it fails

```sh
source ~/.zshenv && pnpm vitest run src/components/editor/collab-backoff.test.ts
```

Expected: FAIL with a resolution error — `Failed to resolve import "./collab-backoff"` (the module does not exist yet).

### Step 1.3 — Write the minimal implementation

Create `src/components/editor/collab-backoff.ts`:

```ts
/**
 * v0.9.8 G3 (audit item I) — deterministic exponential-backoff helper for the
 * collab token re-fetch loop. Pure: the jitter source is injected so unit
 * tests are deterministic without mocking globals. `scheduleWithBackoff`
 * wraps `setTimeout` and returns a cancel function for effect cleanup.
 */

export type BackoffConfig = {
  /** Delay for attempt 0, in ms. */
  baseMs: number;
  /** Upper cap on the exponential term, in ms (applied before jitter). */
  maxMs: number;
  /** Exponential growth factor (e.g. 2 doubles each attempt). */
  factor: number;
  /** Fraction of the capped delay added as random jitter (0..1). */
  jitterRatio: number;
};

/**
 * Production defaults: 1s base, 30s cap, doubling, ±50% jitter band. The
 * collab token TTL is 5 min (README), so a 30s cap reconnects well within a
 * token's validity once the network/DNS recovers.
 */
export const DEFAULT_COLLAB_BACKOFF: BackoffConfig = {
  baseMs: 1000,
  maxMs: 30_000,
  factor: 2,
  jitterRatio: 0.5,
};

/**
 * Compute the delay (ms) for a given 0-based retry attempt.
 * `rand` returns a value in [0,1) (default `Math.random`); injectable for
 * deterministic tests. Jitter is additive (full-jitter-band on top of the
 * capped exponential delay), so the result is in
 * `[capped, capped * (1 + jitterRatio)]`.
 */
export function computeBackoffDelay(
  attempt: number,
  config: BackoffConfig = DEFAULT_COLLAB_BACKOFF,
  rand: () => number = Math.random,
): number {
  const n = Math.max(0, Math.floor(attempt));
  const exponential = config.baseMs * config.factor ** n;
  const capped = Math.min(exponential, config.maxMs);
  const jitter = capped * config.jitterRatio * rand();
  return Math.round(capped + jitter);
}

/**
 * Schedule `callback` to run after the backoff delay for `attempt`. Returns a
 * cancel function that clears the pending timer.
 */
export function scheduleWithBackoff(
  attempt: number,
  config: BackoffConfig,
  callback: () => void,
  rand: () => number = Math.random,
): () => void {
  const delay = computeBackoffDelay(attempt, config, rand);
  const handle = setTimeout(callback, delay);
  return () => clearTimeout(handle);
}
```

### Step 1.4 — Run the test to green

```sh
source ~/.zshenv && pnpm vitest run src/components/editor/collab-backoff.test.ts
```

Expected: PASS — 2 suites, 8 tests passing.

### Step 1.5 — Commit

```sh
git add src/components/editor/collab-backoff.ts src/components/editor/collab-backoff.test.ts && git commit -m "feat(collab): deterministic exponential-backoff helper

Pure computeBackoffDelay (base/max caps + injectable jitter) plus a
scheduleWithBackoff setTimeout wrapper for the collab token re-fetch loop.
Refs audit item I."
```

---

## Task 2 — Token-fetch retry loop with provider recreation

The existing hook (`use-collab-doc.ts:37–73`) fetches the token once inside a `useEffect`; on any non-ok response or thrown error it sets `error`/`disconnected` and gives up. Rewrite the connect effect so a failed token fetch (or a `disconnected` provider event after a prior success) schedules a backoff retry that re-fetches the token and recreates the provider. The IndexedDB effect (lines 81–102) is untouched.

### Step 2.1 — Write the failing test

The connect logic is hard to test through React without a DOM collab harness, so we extract the retry decision into a tiny pure helper and test that. Append to `src/components/editor/collab-backoff.test.ts`:

```ts
import { shouldRetryCollab } from './collab-backoff';

describe('shouldRetryCollab', () => {
  it('retries on a token-fetch failure (no provider yet)', () => {
    expect(shouldRetryCollab({ kind: 'token-failed', cancelled: false })).toBe(true);
  });

  it('retries on a provider disconnect after a prior success', () => {
    expect(shouldRetryCollab({ kind: 'disconnected', cancelled: false })).toBe(true);
  });

  it('does NOT retry once the effect is cancelled (unmount/dep change)', () => {
    expect(shouldRetryCollab({ kind: 'token-failed', cancelled: true })).toBe(false);
    expect(shouldRetryCollab({ kind: 'disconnected', cancelled: true })).toBe(false);
  });

  it('does NOT retry a clean connect', () => {
    expect(shouldRetryCollab({ kind: 'connected', cancelled: false })).toBe(false);
  });
});
```

### Step 2.2 — Run to fail

```sh
source ~/.zshenv && pnpm vitest run src/components/editor/collab-backoff.test.ts
```

Expected: FAIL — `"shouldRetryCollab" is not exported by "src/components/editor/collab-backoff.ts"`.

### Step 2.3 — Add the helper

Append to `src/components/editor/collab-backoff.ts`:

```ts
export type CollabRetryEvent = {
  kind: 'token-failed' | 'disconnected' | 'connected';
  /** True once the effect has been torn down (unmount or dep change). */
  cancelled: boolean;
};

/**
 * Decide whether the collab connect effect should schedule another backoff
 * retry. Retry on a token-fetch failure or a post-connect disconnect, but
 * never after the effect is cancelled (so a torn-down effect can't resurrect
 * a provider on a stale Y.Doc).
 */
export function shouldRetryCollab(event: CollabRetryEvent): boolean {
  if (event.cancelled) return false;
  return event.kind === 'token-failed' || event.kind === 'disconnected';
}
```

### Step 2.4 — Run to green

```sh
source ~/.zshenv && pnpm vitest run src/components/editor/collab-backoff.test.ts
```

Expected: PASS — 3 suites, 12 tests.

### Step 2.5 — Rewrite the connect effect in `use-collab-doc.ts`

Replace the imports block and the first `useEffect` (lines 1–73). First, update the import block at the top of the file:

```ts
'use client';

import { HocuspocusProvider } from '@hocuspocus/provider';
import { useEffect, useMemo, useState } from 'react';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import { recordDocAccess } from '@/lib/offline/doc-index';
import { evictUntilUnderCap } from '@/lib/offline/evict';
import {
  type BackoffConfig,
  DEFAULT_COLLAB_BACKOFF,
  scheduleWithBackoff,
  shouldRetryCollab,
} from './collab-backoff';
```

Then replace the connect `useEffect` (the block from `useEffect(() => {` at line 37 through its closing `}, [pageId, ydoc]);` at line 73) with:

```ts
  // v0.9.8 G3 (audit item I) — resilient connect loop. A token-fetch failure
  // is no longer terminal: we retry the token re-fetch with exponential
  // backoff (base/max caps + jitter) and recreate the HocuspocusProvider after
  // a successful re-fetch. A post-connect `disconnect` also triggers the loop
  // so a dropped socket re-mints a fresh (TTL-bound) token before reconnecting.
  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    let current: HocuspocusProvider | null = null;
    let cancelTimer: (() => void) | null = null;
    const backoff: BackoffConfig = DEFAULT_COLLAB_BACKOFF;

    const scheduleRetry = () => {
      if (!shouldRetryCollab({ kind: 'token-failed', cancelled })) return;
      cancelTimer?.();
      cancelTimer = scheduleWithBackoff(attempt, backoff, () => {
        attempt += 1;
        void connect();
      });
    };

    async function connect(): Promise<void> {
      if (cancelled) return;
      // Drop any prior provider before recreating (avoids two sockets on the
      // same Y.Doc after a reconnect).
      current?.destroy();
      current = null;
      setStatus('connecting');
      try {
        const res = await fetch(`/api/collab/token?pageId=${encodeURIComponent(pageId)}`);
        if (!res.ok) {
          if (!cancelled) setStatus('error');
          scheduleRetry();
          return;
        }
        const { token, collabUrl } = (await res.json()) as { token: string; collabUrl: string };
        if (cancelled) return;

        attempt = 0; // reset backoff on a successful token fetch
        const p = new HocuspocusProvider({
          url: collabUrl,
          name: pageId, // doc name = pageId
          token,
          document: ydoc,
          onStatus: ({ status: s }) => {
            if (cancelled) return;
            setStatus(s === 'connected' ? 'connected' : 'connecting');
          },
          onDisconnect: () => {
            if (cancelled) return;
            setStatus('disconnected');
            // Re-mint a token and recreate the provider with backoff.
            scheduleRetry();
          },
        });
        current = p;
        setProvider(p);
      } catch {
        if (!cancelled) setStatus('error');
        scheduleRetry();
      }
    }

    void connect();

    return () => {
      cancelled = true;
      cancelTimer?.();
      current?.destroy();
      ydoc.destroy();
    };
  }, [pageId, ydoc]);
```

### Step 2.6 — Verify typecheck + the unit suite stay green

```sh
source ~/.zshenv && pnpm typecheck && pnpm vitest run src/components/editor/collab-backoff.test.ts
```

Expected: typecheck exits 0; suite PASS (3 suites, 12 tests).

### Step 2.7 — Commit

```sh
git add src/components/editor/collab-backoff.ts src/components/editor/collab-backoff.test.ts src/components/editor/use-collab-doc.ts && git commit -m "feat(collab): retry token fetch with backoff and recreate provider

A token-fetch failure is no longer terminal: the connect effect retries the
re-fetch with exponential backoff and recreates the HocuspocusProvider after a
successful re-mint; a post-connect disconnect re-mints a TTL-bound token too.
Refs audit item I."
```

---

## Task 3 — i18n keys for the offline banner

Add four keys under a new `collab.offline.*` namespace to all three locale files. `pnpm i18n:check` requires every key present in `en.json` to exist in `es.json` and `ar.json`.

### Step 3.1 — Add the English keys

In `messages/en.json`, add these entries (place them adjacent to the existing `editor.*` block, e.g. after `"editor.link.cancel"`):

```json
  "collab.offline.message": "Collab offline — reconnecting…",
  "collab.offline.detail": "Your changes are saved locally and will sync when the connection returns.",
  "collab.offline.dismiss": "Dismiss",
  "collab.offline.region": "Collaboration status",
```

### Step 3.2 — Add the Spanish keys

In `messages/es.json`, add the matching keys:

```json
  "collab.offline.message": "Colaboración sin conexión: reconectando…",
  "collab.offline.detail": "Tus cambios se guardan localmente y se sincronizarán cuando vuelva la conexión.",
  "collab.offline.dismiss": "Descartar",
  "collab.offline.region": "Estado de la colaboración",
```

### Step 3.3 — Add the Arabic keys

In `messages/ar.json`, add the matching keys:

```json
  "collab.offline.message": "التعاون غير متصل — جارٍ إعادة الاتصال…",
  "collab.offline.detail": "يتم حفظ تغييراتك محليًا وستتم مزامنتها عند عودة الاتصال.",
  "collab.offline.dismiss": "تجاهل",
  "collab.offline.region": "حالة التعاون",
```

### Step 3.4 — Run the i18n audit

```sh
source ~/.zshenv && pnpm i18n:check
```

Expected: exit 0 with no new missing/untranslated keys reported (the four `collab.offline.*` keys present in all three locales).

### Step 3.5 — Commit

```sh
git add messages/en.json messages/es.json messages/ar.json && git commit -m "feat(i18n): collab.offline.* banner strings (en/es/ar)

Refs audit item I."
```

---

## Task 4 — Dismissible offline banner component

A standalone client component, distinct from the toolbar status pill. It renders only when `status` is `disconnected` or `error`, is dismissible (local state), re-appears when a new disconnect transition occurs after a dismiss, and announces via `aria-live="polite"`.

### Step 4.1 — Write the failing test

Create `src/components/editor/collab-offline-banner.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '@/lib/i18n/provider';
import enMessages from '../../../messages/en.json';
import { CollabOfflineBanner } from './collab-offline-banner';

afterEach(cleanup);

function renderBanner(status: 'connecting' | 'connected' | 'disconnected' | 'error') {
  return render(
    <I18nProvider locale="en" messages={enMessages as Record<string, string>}>
      <CollabOfflineBanner status={status} />
    </I18nProvider>,
  );
}

describe('CollabOfflineBanner', () => {
  it('renders nothing when connected', () => {
    const { container } = renderBanner('connected');
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while connecting', () => {
    const { container } = renderBanner('connecting');
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the reconnecting message when disconnected', () => {
    renderBanner('disconnected');
    expect(screen.getByText('Collab offline — reconnecting…')).toBeInTheDocument();
  });

  it('shows the banner on error status too', () => {
    renderBanner('error');
    expect(screen.getByText('Collab offline — reconnecting…')).toBeInTheDocument();
  });

  it('uses an aria-live polite region with an accessible label', () => {
    renderBanner('error');
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAccessibleName('Collaboration status');
  });

  it('hides after the dismiss button is clicked', () => {
    renderBanner('disconnected');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Collab offline — reconnecting…')).not.toBeInTheDocument();
  });
});
```

### Step 4.2 — Run to fail

```sh
source ~/.zshenv && pnpm vitest run src/components/editor/collab-offline-banner.test.tsx
```

Expected: FAIL — `Failed to resolve import "./collab-offline-banner"`.

### Step 4.3 — Implement the component

Create `src/components/editor/collab-offline-banner.tsx`:

```tsx
'use client';

import { WifiOff, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n/provider';
import type { CollabStatus } from './use-collab-doc';

const OFFLINE_STATUSES: ReadonlySet<CollabStatus> = new Set<CollabStatus>([
  'disconnected',
  'error',
]);

/**
 * v0.9.8 G3 (audit item I) — dismissible "Collab offline — reconnecting…"
 * banner, distinct from the small toolbar status pill (editor.tsx). Surfaced
 * on `disconnected`/`error`. Dismiss is sticky until the next offline
 * transition: once the status returns to a non-offline state the dismissal
 * resets, so a *new* drop re-shows the banner even if a prior one was hidden.
 * The whole strip is an aria-live="polite" status region for screen readers.
 */
export function CollabOfflineBanner({ status }: { status: CollabStatus }) {
  const t = useT();
  const offline = OFFLINE_STATUSES.has(status);
  const [dismissed, setDismissed] = useState(false);

  // Reset the dismissal whenever we leave the offline state, so the banner can
  // re-appear on a subsequent disconnect.
  useEffect(() => {
    if (!offline) setDismissed(false);
  }, [offline]);

  return (
    <div role="status" aria-live="polite" aria-label={t('collab.offline.region')}>
      {offline && !dismissed && (
        <div className="mb-2 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-900 text-sm dark:text-amber-200">
          <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{t('collab.offline.message')}</p>
            <p className="text-amber-800/80 text-xs dark:text-amber-200/70">
              {t('collab.offline.detail')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label={t('collab.offline.dismiss')}
            className="-mr-1 shrink-0 rounded p-1 hover:bg-amber-500/20"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
```

### Step 4.4 — Run to green

```sh
source ~/.zshenv && pnpm vitest run src/components/editor/collab-offline-banner.test.tsx
```

Expected: PASS — 6 tests.

### Step 4.5 — Commit

```sh
git add src/components/editor/collab-offline-banner.tsx src/components/editor/collab-offline-banner.test.tsx && git commit -m "feat(collab): dismissible aria-live offline banner

Distinct from the toolbar status pill; shows on disconnected/error, dismiss is
sticky until the next offline transition. i18n via collab.offline.* keys.
Refs audit item I."
```

---

## Task 5 — Mount the banner in the editor

### Step 5.1 — Add the import

In `src/components/editor/editor.tsx`, add the import alongside the other local editor imports (the alphabetical block starting at line 14). Add:

```ts
import { CollabOfflineBanner } from './collab-offline-banner';
```

(Biome will reorder imports on `pnpm lint --write`; place it so the block stays alphabetical — between `./bulk-uploader` and `./drag-handle`.)

### Step 5.2 — Render the banner

In the JSX `return` (line 540), the outer wrapper is `<div className="relative">` with `<EditorDialogs />` as its first child (line 542). Insert the banner immediately after `<EditorDialogs />`:

```tsx
  return (
    <div className="relative">
      <EditorDialogs />
      <CollabOfflineBanner status={status} />
```

`status` is already in scope (destructured from `useCollabDoc` at line 112).

### Step 5.3 — Verify typecheck + lint

```sh
source ~/.zshenv && pnpm typecheck && pnpm lint
```

Expected: typecheck exits 0; lint reports 0 errors.

### Step 5.4 — Commit

```sh
git add src/components/editor/editor.tsx && git commit -m "feat(collab): mount offline banner in the editor

Surfaces the dismissible reconnecting banner above the editor surface, driven
by useCollabDoc status. Refs audit item I."
```

---

## Task 6 — Ops/DNS documentation note

The DNS-dependency is the root cause behind the audited `cairn-collab: rejected connect` / `Unauthorized` symptom when `COLLAB_URL`/`PUBLIC_URL` don't resolve. Document it in both the README troubleshooting section and `docs/operations.md`.

### Step 6.1 — README note

In `README.md`, the collab troubleshooting section ends with `Check the logs with \`docker compose logs cairn-collab\`.` (line 277). Immediately after that line, add a new subsection:

```md

#### DNS resolvability

The browser connects **directly** to the collab WebSocket at `COLLAB_URL`
(and the app mints tokens against `PUBLIC_URL`), so **both hostnames must
resolve from the end-user's network**, not just from inside the Docker
network. If `COLLAB_URL`/`PUBLIC_URL` point at a hostname that resolves only
on the host (or behind a reverse proxy that isn't wired through), the client
sees a failed WebSocket handshake and the editor logs `cairn-collab: rejected
connect` / falls back to local-only edits — even though `AUTH_SECRET` matches.

Symptoms and checks:

- `cairn-collab: rejected connect` in the collab logs, or a browser-console
  WebSocket error against the `COLLAB_URL` host → confirm the host resolves
  publicly (`nslookup <collab-host>` from a client machine) and that your
  reverse proxy forwards the WebSocket upgrade headers.
- Since v0.9.8 the editor surfaces a dismissible **"Collab offline —
  reconnecting…"** banner and retries the token fetch with exponential
  backoff, so a transient DNS/proxy blip self-heals once resolution returns.
```

### Step 6.2 — operations.md note

In `docs/operations.md`, the collab trust-domain section discusses diagnosing rejections (around line 438). After that diagnosing-rejections bullet, add:

```md
- **DNS resolvability is a hard dependency.** The browser connects directly to
  `COLLAB_URL` and the app mints tokens against `PUBLIC_URL`; both must resolve
  from the **client's** network, not only inside Docker. A non-resolving
  hostname (or a reverse proxy that drops the WebSocket upgrade) presents the
  same `cairn-collab: rejected connect` / `Unauthorized` symptom as a secret
  mismatch. Since v0.9.8 the client retries the token fetch with exponential
  backoff and shows a dismissible "Collab offline — reconnecting…" banner, so
  the editor recovers automatically once resolution is restored.
```

### Step 6.3 — Commit

```sh
git add README.md docs/operations.md && git commit -m "docs(collab): document COLLAB_URL/PUBLIC_URL DNS dependency

Notes that both hostnames must resolve from the client network and that the
v0.9.8 client retries with backoff + shows an offline banner. Refs audit
item I."
```

---

## Task 7 — Playwright: banner appears on simulated socket drop

Drive the seeded editor, confirm the banner is absent while connected, then simulate a socket drop by killing the page's WebSocket connections (force-close every open `WebSocket` and block reconnects) so `onDisconnect` fires and the banner surfaces.

### Step 7.1 — Write the spec

Create `tests/a11y/collab-offline.spec.ts`:

```ts
import { DARK_INIT } from '../../playwright.config';
import { expect, signIn, test } from './fixtures';

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === 'dark') {
    await page.addInitScript(DARK_INIT);
  }
});

test.describe('collab offline banner (audit item I)', () => {
  test('surfaces a dismissible reconnecting banner on socket drop', async ({ page, seeded }) => {
    await signIn(page, seeded);
    await page.goto(`/pages/${seeded.pageId}`);

    // Wait until the editor mounts and the collab provider has connected.
    await page
      .locator('.ProseMirror[role="textbox"][aria-label="Page content"]')
      .first()
      .waitFor({ state: 'attached', timeout: 15_000 });

    const banner = page.getByText('Collab offline — reconnecting…');
    await expect(banner).toBeHidden();

    // Simulate a transport drop: monkey-patch WebSocket to refuse new sockets,
    // then force-close every currently-open socket so HocuspocusProvider fires
    // onDisconnect. The patched constructor makes the backoff re-fetch's new
    // provider fail to connect, so the banner stays up deterministically.
    await page.evaluate(() => {
      const sockets = (window as unknown as { __cairnSockets?: WebSocket[] }).__cairnSockets ?? [];
      const NativeWS = window.WebSocket;
      class DeadWS extends NativeWS {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          // Immediately abort so reconnect attempts never establish.
          queueMicrotask(() => this.close());
        }
      }
      (window as unknown as { WebSocket: typeof WebSocket }).WebSocket =
        DeadWS as unknown as typeof WebSocket;
      for (const ws of sockets) {
        try {
          ws.close();
        } catch {
          /* already closed */
        }
      }
    });

    // The banner is an aria-live status region; it appears on disconnect/error.
    await expect(banner).toBeVisible({ timeout: 15_000 });

    const region = page.getByRole('status', { name: 'Collaboration status' });
    await expect(region).toHaveAttribute('aria-live', 'polite');

    // Dismiss hides it.
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(banner).toBeHidden();
  });
});
```

> Executor note: the harness's collab provider uses the page's native `WebSocket`. If the seeded editor does not expose `window.__cairnSockets`, fall back to overriding `window.WebSocket` with the `DeadWS` shim **inside an `addInitScript`** (before navigation) that also pushes each constructed socket into `window.__cairnSockets`, then trigger a reconnect by toggling `page.context().setOffline(true)`. The assertion (banner visible + `aria-live="polite"` + dismiss hides it) is the contract; the drop mechanism may be adapted to however the harness wires the socket, but must remain deterministic.

### Step 7.2 — Run the spec

```sh
source ~/.zshenv && pnpm test:a11y tests/a11y/collab-offline.spec.ts
```

Expected: PASS for the `light` (and `dark`) project — banner hidden while connected, visible after the simulated drop, `aria-live="polite"` present, hidden again after Dismiss.

### Step 7.3 — Commit

```sh
git add tests/a11y/collab-offline.spec.ts && git commit -m "test(collab): playwright banner-on-socket-drop e2e

Asserts the offline banner is hidden while connected, surfaces on a simulated
WebSocket drop with aria-live=polite, and hides after Dismiss. Refs audit
item I."
```

---

## Task 8 — G3 verification gate

Run the full per-group gate. All must pass before this group is considered done.

### Step 8.1 — Lint (0 errors)

```sh
source ~/.zshenv && pnpm lint
```

Expected: Biome reports 0 errors. (If it auto-reordered imports in `editor.tsx`/`use-collab-doc.ts`, re-run `pnpm lint --write` then `git add -A` those files into the next commit.)

### Step 8.2 — Typecheck

```sh
source ~/.zshenv && pnpm typecheck
```

Expected: `tsc --noEmit` exits 0.

### Step 8.3 — i18n check (no new untranslated keys)

```sh
source ~/.zshenv && pnpm i18n:check
```

Expected: exit 0; the four `collab.offline.*` keys present in en/es/ar, no missing keys reported.

### Step 8.4 — Group vitest

```sh
source ~/.zshenv && pnpm vitest run src/components/editor/collab-backoff.test.ts src/components/editor/collab-offline-banner.test.tsx
```

Expected: PASS — 4 suites total (3 in `collab-backoff.test.ts`, 1 in `collab-offline-banner.test.tsx`), 18 tests.

### Step 8.5 — Build

```sh
source ~/.zshenv && pnpm build; echo "BUILD_EXIT=$?"
```

Expected: `BUILD_EXIT=0`. (In-build TS phase is skipped per the v0.9.7 fix — types are gated by Step 8.2.)

### Step 8.6 — Commit any gate fixups

If Steps 8.1–8.5 required no changes, skip this commit. Otherwise:

```sh
git add -A && git commit -m "chore(collab): G3 verification-gate fixups

Lint/typecheck/i18n/build gate for collab resilience (audit item I)."
```
