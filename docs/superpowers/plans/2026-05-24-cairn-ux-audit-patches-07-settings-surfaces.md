# P07 — Settings Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Show email + display name on the profile page (or fix the copy), add a copy-to-clipboard for the User ID, restyle the developer "Create key" button to primary, and surface MCP connection info on the developer settings area.

**Architecture:** `src/app/(app)/settings/account/profile/page.tsx`, `src/components/settings/api-keys-manager.tsx`, and the developer settings route. The auth context (`getAuthContext`/session) is the source for email/display name.

**Tech Stack:** React 19 RSC + a small client copy button, shadcn `Button`, Auth.js session.

**Covers:** GH #32 (a23 profile fields), #33 (a24 UUID copy), #34 (a25 button style), #35 (a26 MCP info).

---

### Task 1: Render email + display name on profile (#32)

**Files:**
- Modify: `src/app/(app)/settings/account/profile/page.tsx` (copy ~L17-19, User ID ~L23)
- Reference: the auth context — `src/lib/auth/require-role.ts` (`getAuthContext`) and the session/user record.

- [ ] **Step 1: Determine what the auth context exposes**

Read `getAuthContext` and the users table/session to find `email` and `displayName`/`name`. Two outcomes:
- If email + name ARE available on the context/session → render them.
- If they are genuinely not available under the current auth (credentials provider may only have a user id) → fix the copy to describe only what is shown.

Prefer rendering. Add the fields to the `<dl>`:

```tsx
<div>
  <dt className="text-sm text-muted-foreground">Email</dt>
  <dd>{ctx.email ?? '—'}</dd>
</div>
<div>
  <dt className="text-sm text-muted-foreground">Display name</dt>
  <dd>{ctx.displayName ?? ctx.name ?? '—'}</dd>
</div>
```

Use the real field names from the context type. If only some fields exist, render those and trim the promise in the intro copy accordingly so copy matches reality.

- [ ] **Step 2: Verify**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck`
Expected: clean. In `pnpm dev`, profile shows email + display name (or the copy now matches what's shown).

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/settings/account/profile/page.tsx"
git commit -m "fix(settings): show email + display name on profile (copy matches fields) — Closes #32"
```

---

### Task 2: Copy-to-clipboard for the User ID (#33)

**Files:**
- Create: `src/components/settings/copy-button.tsx`
- Modify: `src/app/(app)/settings/account/profile/page.tsx` (User ID `<dd>` ~L23)
- Test: `tests/components/settings/copy-button.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyButton } from '@/components/settings/copy-button';

afterEach(cleanup);

describe('<CopyButton>', () => {
  it('writes the value to the clipboard on click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CopyButton value="abc-123" label="Copy User ID" />);
    fireEvent.click(screen.getByRole('button', { name: /copy user id/i }));
    expect(writeText).toHaveBeenCalledWith('abc-123');
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/settings/copy-button.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the copy button**

```tsx
'use client';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function onCopy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <Button type="button" variant="ghost" size="sm" aria-label={label} onClick={onCopy}>
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}
```

Render it next to the User ID:

```tsx
<dd className="flex items-center gap-2 font-mono">
  {ctx.userId}
  <CopyButton value={ctx.userId} label="Copy User ID" />
</dd>
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `source ~/.zshenv && pnpm vitest run tests/components/settings/copy-button.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/copy-button.tsx "src/app/(app)/settings/account/profile/page.tsx" tests/components/settings/copy-button.test.tsx
git commit -m "feat(settings): copy-to-clipboard for User ID — Closes #33"
```

---

### Task 3: Restyle "Create key" as primary (#34)

**Files:**
- Modify: `src/components/settings/api-keys-manager.tsx` (create-key button)

- [ ] **Step 1: Use the primary Button variant**

Find the "Create key" button (currently a light-grey pill). Replace with the shadcn `Button` default/primary variant so it matches primary actions elsewhere:

```tsx
<Button type="submit" /* or onClick */>Create key</Button>
```

Remove the ad-hoc grey pill classes. Keep the existing submit/mutation handler.

- [ ] **Step 2: Verify**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck`
Expected: clean. In `pnpm dev` (dark theme), the button matches other primary buttons.

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/api-keys-manager.tsx
git commit -m "polish(settings): primary-styled Create key button — Closes #34"
```

---

### Task 4: Surface MCP connection info on developer settings (#35)

**Files:**
- Modify: `src/app/(app)/settings/developer/api-keys/page.tsx` (add an MCP info panel) — or the developer layout
- Reference: the v0.7 MCP transport endpoint (`/api/mcp` or similar — grep for the MCP route to get the real path) and PAT scopes.

- [ ] **Step 1: Find the real MCP endpoint + scope list**

Grep for the MCP HTTP transport route (`src/app/api/mcp` / `mcp` handler) and the PAT scope definitions. Capture: the connection URL (origin + path), the auth method (Bearer PAT), and the available scopes.

- [ ] **Step 2: Add an MCP connection info panel**

Add a read-only info section to the developer settings (api-keys page or a sibling panel):

```tsx
<section className="rounded-lg border p-4">
  <h2 className="text-sm font-semibold">MCP connection</h2>
  <p className="mt-1 text-sm text-muted-foreground">
    Connect an MCP client using a personal access token as a Bearer credential.
  </p>
  <dl className="mt-3 space-y-2 text-sm">
    <div className="flex items-center gap-2">
      <dt className="w-24 text-muted-foreground">Endpoint</dt>
      <dd className="font-mono">{mcpUrl}</dd>
      <CopyButton value={mcpUrl} label="Copy MCP endpoint" />
    </div>
    <div className="flex gap-2">
      <dt className="w-24 text-muted-foreground">Scopes</dt>
      <dd className="font-mono">{scopes.join(', ')}</dd>
    </div>
  </dl>
</section>
```

Compute `mcpUrl` from the app origin (use the existing public-URL/env helper) + the real MCP path. Reuse the `CopyButton` from Task 2.

- [ ] **Step 3: Verify**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm build`
Expected: clean. In `pnpm dev`, developer settings shows the MCP panel with the correct endpoint + scopes.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/settings/developer/api-keys/page.tsx"
git commit -m "feat(settings): surface MCP connection info + scopes — Closes #35"
```

---

## Self-Review

- Covers #32, #33, #34, #35. ✓
- Copy button TDD'd; reused for MCP panel (DRY). ✓
- #32 + #35 require reading the auth context + MCP route for real values — flagged, not assumed. ✓
- #34 is a variant swap with visual verification. ✓
