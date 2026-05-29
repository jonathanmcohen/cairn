# P14 — MCP Endpoint Origin (deploy-correct) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The "MCP connection" panel on `/settings/developer/api-keys` (and the sibling personal-tokens panel) must render the deployed instance's real origin — e.g. `https://cairn.local.jonco.dev/api/mcp` — never the build-time `http://localhost:3000`. Replace the brittle `process.env.PUBLIC_URL ?? 'http://localhost:3000'` expression with a single SSR-correct `publicOrigin()` helper that resolves the origin from runtime sources in a reliable order.

**Root cause (diagnose-first — #50 reopens round-1 #35):** The round-1 fix computed the endpoint as `${process.env.PUBLIC_URL ?? 'http://localhost:3000'}/api/mcp`. In the shipped container this evaluates to `http://localhost:3000` because **`PUBLIC_URL` is never passed into the app container**. `docker-compose.yml` only does `NEXTAUTH_URL: ${PUBLIC_URL}` (host-side interpolation of the compose `.env`); the `cairn` service `environment:` block has **no `PUBLIC_URL` key**, so `process.env.PUBLIC_URL` is `undefined` at runtime and the `?? 'http://localhost:3000'` branch wins. `NEXTAUTH_URL`, by contrast, IS set in the container (to the operator's `PUBLIC_URL` value) and is a **required, Zod-validated `z.url()`** in `src/lib/env.ts`. That is the reliable canonical origin in this self-hosted deploy. The `Dockerfile` bakes `ENV NEXTAUTH_URL=http://localhost:3000` as a build-time default, but compose overrides it at runtime — so the helper must still prefer the live request host when the env value is the localhost default, to stay correct under reverse proxies that set a different external host than the operator typed.

**Architecture:** Add `src/lib/url.ts#publicOrigin()` — a server-only async helper. Resolution order (first non-localhost wins; localhost is only ever the last-resort fallback):
1. `process.env.PUBLIC_URL` if set and non-empty (kept first so a future compose change that DOES pass `PUBLIC_URL` is honoured, and so dev/`.env` keeps working).
2. The incoming request's forwarded host: `X-Forwarded-Host` (set by the Caddy TLS overlay / any reverse proxy) else `Host`, combined with `X-Forwarded-Proto` (else `https` when a forwarded host is present, since external ingress is TLS-terminated; else `http`). Read via `next/headers` `headers()`.
3. `process.env.NEXTAUTH_URL` — the validated runtime canonical origin (always set in compose).
4. `'http://localhost:3000'` — last resort (dev with no proxy, no env).

Ordering rationale: in the **reverse-proxy deploy** (`docker-compose.proxy.yml` + Caddy), the operator sets `PUBLIC_URL`/`NEXTAUTH_URL` to `https://<domain>`, so step 1 or 3 yields the right value and step 2 confirms it. In the **bare compose deploy without `PUBLIC_URL` in the container** (the #50 repro), step 1 is empty, step 2 reads the real `Host` the user actually reached the app on (e.g. `cairn.local.jonco.dev`), and we never fall through to localhost. We deliberately try the request host (step 2) BEFORE `NEXTAUTH_URL` (step 3) only when the env value is the localhost build-default; if `NEXTAUTH_URL` is a real external origin we prefer it (operator-declared canonical). See the helper code for the exact precedence.

**Tech Stack:** Next 16 App Router server components, `next/headers` `headers()` (async in Next 16), existing `CopyButton` (`src/components/settings/copy-button.tsx`), Vitest 4. No new deps.

**Covers:** GH #50 (reopens round-1 #35).

**Files touched:**
- Create: `src/lib/url.ts`
- Create: `tests/lib/url.test.ts`
- Modify: `src/app/(app)/settings/developer/api-keys/page.tsx`
- Modify: `src/app/(app)/settings/developer/tokens/page.tsx` (same latent bug — fix both panels in one pass)
- (No component changes — reuse the round-1 `CopyButton` and the existing client `McpConnectionInfo`, both of which already take a string prop.)

---

### Task 1: Add the `publicOrigin()` server helper (TDD)

**Files:**
- Create: `src/lib/url.ts`
- Create: `tests/lib/url.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/lib/url.test.ts`
Expected: FAIL — module `@/lib/url` not found.

- [ ] **Step 3: Implement the helper**

```ts
import { headers } from 'next/headers';

const LOCALHOST = 'http://localhost:3000';

function stripTrailingSlash(origin: string): string {
  return origin.replace(/\/+$/, '');
}

/** True for the build-default localhost origin (Dockerfile bakes this; compose overrides at runtime). */
function isLocalhostDefault(value: string | undefined): boolean {
  if (!value) return true;
  try {
    const { hostname } = new URL(value);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
  } catch {
    return true;
  }
}

/**
 * The deployed instance's public origin (scheme + host [+ port]), with no trailing slash.
 *
 * Server-only (reads the incoming request via next/headers). Resolution order:
 *  1. PUBLIC_URL                — explicit operator-declared base (dev `.env`, or a
 *                                 future compose that DOES pass it into the container).
 *  2. forwarded request host    — X-Forwarded-Host || Host, with X-Forwarded-Proto
 *                                 (https inferred for a forwarded host). This is what
 *                                 fixes #50: bare compose never passes PUBLIC_URL to
 *                                 the container, so we read the host the user reached.
 *  3. NEXTAUTH_URL              — validated runtime canonical (compose sets it = PUBLIC_URL),
 *                                 used over the request host when it is a REAL external origin.
 *  4. http://localhost:3000     — last resort (dev, no proxy, no env).
 *
 * Note: NEXTAUTH_URL is preferred over the request host ONLY when it is a real external
 * origin; when it is the localhost build-default we fall through to the request host so a
 * reverse-proxied deploy that didn't override NEXTAUTH_URL still renders the real host.
 */
export async function publicOrigin(): Promise<string> {
  const explicit = process.env.PUBLIC_URL?.trim();
  if (explicit) return stripTrailingSlash(explicit);

  const nextAuth = process.env.NEXTAUTH_URL?.trim();
  if (nextAuth && !isLocalhostDefault(nextAuth)) return stripTrailingSlash(nextAuth);

  const hdrs = await headers();
  const forwardedHost = hdrs.get('x-forwarded-host');
  const host = forwardedHost ?? hdrs.get('host');
  if (host) {
    const proto = hdrs.get('x-forwarded-proto') ?? (forwardedHost ? 'https' : 'http');
    return stripTrailingSlash(`${proto}://${host}`);
  }

  if (nextAuth) return stripTrailingSlash(nextAuth);
  return LOCALHOST;
}
```

> Implementer note: the test's "prefers real external NEXTAUTH_URL over request host" case passes because step 3 (the `!isLocalhostDefault` guard) runs before the header read. The "#50 repro" case has `NEXTAUTH_URL=http://localhost:3000` (localhost-default → skipped), so it reads `x-forwarded-host`. Verify both pass; if ordering needs a tweak, keep the *behaviour* the tests assert and adjust the code, not the tests.

- [ ] **Step 4: Run the test, confirm it passes**

Run: `source ~/.zshenv && pnpm vitest run tests/lib/url.test.ts`
Expected: PASS (all 6 cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/url.ts tests/lib/url.test.ts
git commit -m "feat(url): add SSR publicOrigin() helper (forwarded-host aware) — refs #50"
```

---

### Task 2: Wire the helper into the `/settings/developer/api-keys` MCP panel (#50)

**Files:**
- Modify: `src/app/(app)/settings/developer/api-keys/page.tsx` (L42-45 — the `mcpUrl` derivation)

- [ ] **Step 1: Replace the hardcoded-localhost derivation**

Add the import alongside the other `@/lib/...` imports:

```ts
import { publicOrigin } from '@/lib/url';
```

Replace lines 42-45 (the comment block + `const mcpUrl = …`) with:

```ts
  // Deploy-correct MCP endpoint. publicOrigin() resolves the real public origin
  // from PUBLIC_URL / the forwarded request host / NEXTAUTH_URL (never the
  // build-time localhost default — see GH #50 / src/lib/url.ts). The MCP HTTP
  // transport route is src/app/api/mcp/route.ts → `/api/mcp`.
  const mcpUrl = `${await publicOrigin()}/api/mcp`;
```

The component is already `async` (it `await`s `getAuthContext()` and the db query), so `await publicOrigin()` needs no signature change. The `CopyButton` usage at L88-90 and the `<dd>` rendering of `{mcpUrl}` stay exactly as-is — reuse the round-1 `CopyButton`.

- [ ] **Step 2: Verify (typecheck + lint)**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck`
Expected: clean. (Biome may reorder the new import — accept.)

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/settings/developer/api-keys/page.tsx"
git commit -m "fix(settings): MCP endpoint uses real public origin, not localhost — Closes #50"
```

---

### Task 3: Fix the sibling personal-tokens MCP panel (same latent bug)

**Files:**
- Modify: `src/app/(app)/settings/developer/tokens/page.tsx` (L46 — `const publicUrl = process.env.PUBLIC_URL ?? 'http://localhost:3000';`)

> Why here too: `tokens/page.tsx` passes `publicUrl` into `<McpConnectionInfo publicUrl={…}>`, which builds `${publicUrl}/api/mcp` and renders it in the Claude Desktop / Cursor config snippets. It has the **identical** `PUBLIC_URL ?? localhost` defect and is the panel the api-keys page even tells users to visit. Fix both so #50 doesn't reappear via the other surface.

- [ ] **Step 1: Replace the derivation**

Add the import:

```ts
import { publicOrigin } from '@/lib/url';
```

Replace L46:

```ts
  const publicUrl = process.env.PUBLIC_URL ?? 'http://localhost:3000';
```

with:

```ts
  // Real public origin (forwarded-host aware) — see src/lib/url.ts / GH #50.
  const publicUrl = await publicOrigin();
```

`DeveloperSettingsPage` is already `async`. `McpConnectionInfo` (client component) is unchanged — it already takes `publicUrl: string`.

- [ ] **Step 2: Verify**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/settings/developer/tokens/page.tsx"
git commit -m "fix(settings): personal-tokens MCP config uses real public origin — refs #50"
```

---

### Task 4: Document the helper as the canonical origin source + final verify

**Files:**
- (Optional) Modify: `.env.example` near L25-26 — clarify that `PUBLIC_URL` is compose-host-only and that the app derives its origin at runtime.

- [ ] **Step 1: Clarify the `.env.example` comment (optional, low-risk)**

The current comment (L25) says `PUBLIC_URL` is "used by docker-compose for NEXTAUTH_URL". Append a sentence so operators know the in-app origin now comes from `NEXTAUTH_URL` / the request host, not from `PUBLIC_URL` being present in the container:

```
# Public base URL. docker-compose interpolates this into NEXTAUTH_URL (the value
# the container actually sees). The app derives its public origin from
# NEXTAUTH_URL or the incoming request host at runtime — see src/lib/url.ts.
PUBLIC_URL=http://localhost:3000
```

- [ ] **Step 2: Grep-gate — no hardcoded localhost left in the MCP panels**

Run: `source ~/.zshenv && grep -rn "localhost:3000" "src/app/(app)/settings/developer/"`
Expected: NO matches (both panels now go through `publicOrigin()`). If anything remains, it was missed — fix it.

- [ ] **Step 3: Full verify gate**

Run: `source ~/.zshenv && pnpm vitest run tests/lib/url.test.ts && pnpm lint && pnpm typecheck && pnpm build`
Expected: url tests PASS; lint/types clean; `pnpm build` succeeds (UI/route change → build is part of the gate per the round-2 index). Note: `publicOrigin()` is `async` and reads `headers()`, which opts the two pages into dynamic rendering — confirm the build does not error trying to statically prerender them (they are already dynamic: both call `getAuthContext()`/`auth()` which read cookies).

- [ ] **Step 4: Commit**

```bash
git add .env.example
git commit -m "docs(env): clarify PUBLIC_URL is compose-host-only; app derives origin at runtime — refs #50"
```

---

## Self-Review

- Diagnose-first satisfied: root cause is that the `cairn` container never receives `PUBLIC_URL` (compose only sets `NEXTAUTH_URL: ${PUBLIC_URL}`), so the round-1 `?? localhost` branch fired in deploy. ✓
- SSR-correct: helper is server-only, reads `next/headers` `headers()` (async, Next 16). Both pages are already `async` + dynamic. ✓
- No hardcoded localhost in the rendered output: localhost is only the last-resort fallback when there is no env AND no request host (effectively never in a real deploy). Grep gate in Task 4 enforces it. ✓
- Yields the target value: in the bare-compose #50 repro, `X-Forwarded-Host: cairn.local.jonco.dev` → `https://cairn.local.jonco.dev/api/mcp`. ✓
- Reuses round-1 primitives: `CopyButton` (api-keys panel) and `McpConnectionInfo` (tokens panel) are untouched — only the string they receive changed. ✓
- Both MCP surfaces fixed (api-keys + personal-tokens) so #50 can't resurface via the sibling panel. ✓
- Verify gate: url unit test + lint + typecheck + build, per the round-2 index. ✓
- `Closes #50` on the primary commit (Task 2); supporting commits use `refs #50`. ✓
