# P17 — Security & Notifications Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Branch is `patches/ux-audit-v0.9.4` (do NOT switch). Prefix every shell command with `source ~/.zshenv && `.

**Goal:** Finish the Security and Notifications settings surfaces flagged in the round-2 deploy review (#68–#74), and re-fix the two reopened `/notifications` filter issues (#29, #30) — each reopened item starts with a *diagnose-why-round-1-didn't-hold* step before any code changes.

**Architecture / key facts established by investigation:**

- **WebAuthn/passkeys (#68) backend is COMPLETE.** `src/db/schema/webauthn.ts` (`user_webauthn_credentials`), `@simplewebauthn/server`, and the full API surface (`/api/webauthn/register-options`, `/register`, `/assert-options`, `/assert`, `/credentials` GET, `/credentials/[credentialId]` DELETE) all exist. A **fully built page** already lives at `/settings/security/passkeys` (`src/app/(app)/settings/security/passkeys/page.tsx`) with enrollment (`src/components/security/passkey-enrollment.tsx`), the credential list (`src/components/security/passkey-list-item.tsx`), and a clean "WebAuthn not configured" fallback when `CAIRN_RP_ID`/`CAIRN_RP_ORIGIN` are unset. **The only gap is discoverability:** the Security landing page (`src/app/(app)/settings/security/page.tsx`) renders only `<TwoFactorCard>` and never links to the passkeys page. #68 is therefore a **link/surfacing fix, not net-new** — feasible now.
- **Recovery codes (#69):** the TOTP lib (`src/lib/auth/two-factor.ts` + `src/lib/auth/totp.ts`) already generates codes (`generateRecoveryCodes`), stores them **hashed** with `usedAt` in `user_totp.recovery_codes` (jsonb), and consumes them single-use (`consumeRecoveryCode`). Codes are returned in plaintext ONCE during enroll. **Missing backend:** (a) an endpoint to report how many codes remain unused, and (b) a regenerate endpoint. Both are small, server-only additions to existing tables — **feasible now** (modest backend).
- **Active sessions / sign-out-everywhere (#70):** session strategy is **`jwt`** (`src/lib/auth/config.ts` L102: `session: { strategy: 'jwt' }`), forced by the Credentials provider (see CLAUDE.md gotcha). The `sessions` table is wired into the DrizzleAdapter but is **inert under jwt** — there is **no server-side session store to enumerate**. A true "active sessions list + revoke" needs a net-new mechanism (a `users.token_version` / JWT denylist that the `jwt`/`session` callbacks consult). This is the **single heavy item** → scoped as a larger sub-task and **flagged to slip to a follow-up release** (see Task 5). This plan ships a *correct, honest* minimal slice ("Sign out of this browser" + a clear explanation), not a fake sessions table.
- **Notification email-pref types (#72):** `src/lib/email/prefs.ts` hard-codes `NOTIFICATION_TYPES = ['mention', 'comment_reply']` (also the `z.enum` in `src/app/api/notifications/prefs/route.ts`). The real `notifications.type` enum (`src/db/schema/notifications.ts`) has **five** values: `mention | comment_reply | reminder | flashcards_due | upgrade_available`. We align prefs to the types that are actually *emailable* and hide/omit the rest with a documented rationale.
- **SMTP-configured detection (#73/#74):** single source of truth is `emailEnabled()` in `src/lib/email/transport.ts` (true iff `SMTP_HOST` is set). The prefs GET route already returns `emailEnabled` to the client; `src/components/settings/notification-prefs.tsx` already reads it into `smtpEnabled`, already disables email-bearing choices when unset, and already renders an **amber/info** banner (not red). So #73 is largely DONE and #74 is largely DONE — this plan **verifies + hardens** them (disabled-reason tooltip, banner copy via i18n) rather than rebuilding.
- **i18n:** flat dot-keys in `messages/{en,es,ar}.json` consumed via `useT()` from `@/lib/i18n/provider` (client) / `createT` (server). New user-facing strings must go through `t()` with keys added to **all three** catalogs; the i18n gate is `pnpm i18n:check` (diffs `i18n-audit.baseline.json`; regenerate with `pnpm i18n:baseline` only if a genuinely new tolerated literal is unavoidable).
- **Button variants** (`src/components/ui/button.tsx`): `default` (primary, `bg-primary`), `destructive`, `outline`, `secondary`, `ghost`, `link`. `default` is the themed primary — the fix target for #71/#34-family grey-pill issues.

**Tech Stack:** React 19, Next 16 (App Router, RSC), Drizzle + Postgres, `radix-ui` 1.4.3, Tailwind v4, Auth.js v5 (jwt). `cn()` from `src/lib/utils.ts`. Tests: Vitest 4 (jsdom for components, Testcontainers Postgres for routes/lib).

**Covers:** GH #71 (feasible now), #68 (feasible now — link existing page), #69 (feasible now — small backend), #70 (**flagged large — partial now, full slips**), #72, #73 (verify/harden), #74 (verify/harden), and **reopened** #29, #30.

**Verify gate (every task):** `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm test`; UI/route changes also `pnpm build`; new strings also `pnpm i18n:check`. New interactive controls: WCAG AA contrast + ≥44px touch targets.

---

### Task 1: #71 — "Set up 2FA" button → primary themed variant (TRIVIAL)

Same fix family as #34 (grey off-theme pill → themed primary). The `<Button>` on the Security page already has *no* `variant`, so it defaults to `default` (primary). **Confirm in-file first** — if it is genuinely the primary variant and still looks grey, the off-theme look is coming from somewhere else (a wrapper class or the disable-state). Read before editing.

**Files:**
- Modify: `src/app/(app)/settings/security/two-factor-card.tsx`
- Test: `tests/components/security/two-factor-card.test.tsx` (create)

- [ ] **Step 1: Diagnose the actual grey source**

Read `src/app/(app)/settings/security/two-factor-card.tsx`. The "Set up 2FA" button is `<Button onClick={() => void begin()}>Set up 2FA</Button>` (~L82) — no `variant`, so it should already render `bg-primary`. If the audit screenshot shows a grey pill, the likely cause is one of:
  - the button is being rendered through a wrapper that overrides color, or
  - the screenshot predates a fix, or
  - the audit is actually pointing at the **"Confirm & enable"** button (~L109, also default) or the disable-state styling.

Record the finding in the commit body. If the button is already correctly primary and renders `bg-primary` in the test below, the fix is to make that **explicit** (`variant="default"`) so future audits can't regress it silently, and to route the label through i18n.

- [ ] **Step 2: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '@/lib/i18n/provider';
import { getMessages } from '@/lib/i18n/messages';
import { TwoFactorCard } from '@/app/(app)/settings/security/two-factor-card';

afterEach(cleanup);

function renderWithI18n(ui: React.ReactNode) {
  return render(
    <I18nProvider locale="en" messages={getMessages('en')}>
      {ui}
    </I18nProvider>,
  );
}

describe('<TwoFactorCard>', () => {
  it('renders the set-up CTA as a themed primary button (not an off-theme grey pill)', () => {
    renderWithI18n(<TwoFactorCard initiallyEnabled={false} />);
    const btn = screen.getByRole('button', { name: /set up 2fa/i });
    expect(btn.className).toContain('bg-primary');
    expect(btn.className).toContain('text-primary-foreground');
  });
});
```

- [ ] **Step 3: Run it, confirm pass/fail and react**

Run: `source ~/.zshenv && pnpm vitest run tests/components/security/two-factor-card.test.tsx`
If it already PASSES, the button is themed — proceed to make `variant="default"` explicit + i18n the label so the assertion is durable. If it FAILS, apply the variant fix.

- [ ] **Step 4: Apply the fix + i18n the label**

In `two-factor-card.tsx`: add `const t = useT();` (import `import { useT } from '@/lib/i18n/provider';`). Make the CTA explicit and translated:

```tsx
<Button variant="default" onClick={() => void begin()}>
  {t('security.twoFactor.setup')}
</Button>
```

If `'use client'` already at top (it is), `useT()` works. The component must be rendered inside an `I18nProvider` — the `(app)` layout already wraps the tree; **verify** the security page is under that provider (it is, via the app layout). Add keys to all three catalogs:

```json
"security.twoFactor.setup": "Set up 2FA"
```
(`messages/en.json`; provide ES + AR or copy the EN value as a placeholder per the project's existing pattern — match how sibling keys like `locale.*` are populated.)

- [ ] **Step 5: Verify + commit**

Run: `source ~/.zshenv && pnpm vitest run tests/components/security/two-factor-card.test.tsx && pnpm lint && pnpm typecheck && pnpm i18n:check && pnpm build`

```bash
git add src/app/\(app\)/settings/security/two-factor-card.tsx tests/components/security/two-factor-card.test.tsx messages/en.json messages/es.json messages/ar.json
git commit -m "fix(security): themed primary Set-up-2FA CTA + i18n label — Closes #71"
```

---

### Task 2: #68 — Surface the existing passkeys page from Security settings (feasible now)

The passkeys feature is fully built and routable at `/settings/security/passkeys`, but the Security landing page never links to it, so users can't discover it ("only TOTP, no WebAuthn UI"). Add a passkeys card/section with a link. **Do not duplicate** the enrollment UI here — link to the existing page.

**Files:**
- Modify: `src/app/(app)/settings/security/page.tsx`
- Test: `tests/app/settings/security-page.test.tsx` (create — RSC render or a thin assertion via the route's component)

- [ ] **Step 1: Confirm the passkeys route + components exist**

Read `src/app/(app)/settings/security/passkeys/page.tsx`, `src/components/security/passkey-enrollment.tsx`, `src/components/security/passkey-list-item.tsx`, and `src/app/api/webauthn/credentials/route.ts`. Confirm the route renders an enroll form + list and degrades cleanly when `CAIRN_RP_ID`/`CAIRN_RP_ORIGIN` are unset. (Investigation already confirmed this — re-confirm before linking so the link doesn't point at a 404.)

- [ ] **Step 2: Add a "Passkeys" section + link on the Security page**

In `src/app/(app)/settings/security/page.tsx`, after `<TwoFactorCard …/>`, add a themed section that links to the passkeys page. Use a typed `Route`. Example:

```tsx
import Link from 'next/link';
// …
<section className="space-y-3 rounded-lg border p-4">
  <h2 className="font-medium">{t('security.passkeys.title')}</h2>
  <p className="text-muted-foreground text-sm">{t('security.passkeys.blurb')}</p>
  <Button asChild variant="default" className="min-h-11">
    <Link href={'/settings/security/passkeys' as Route}>
      {t('security.passkeys.manage')}
    </Link>
  </Button>
</section>
```

This is a Server Component — use the **server** `createT(locale, getMessages(locale))` rather than the `useT()` hook (read how a sibling RSC settings page resolves locale; if none is wired server-side, fall back to `DEFAULT_LOCALE` via `getMessages`). If wiring server-side i18n is non-trivial in an RSC, it is acceptable to keep these two strings as plain literals **with a `// biome-ignore i18n:` escape hatch** matching the existing baseline pattern — note which approach was used in the commit body. **Do not block the link on i18n plumbing.**

- [ ] **Step 3: Test the link is present**

```tsx
// @vitest-environment jsdom
// Render the section markup (extract a small presentational sub-component if the
// page is an async RSC that can't be rendered directly under jsdom) and assert
// a link with href "/settings/security/passkeys" exists with an accessible name.
```
If the page is an async RSC and awkward to render in jsdom, instead add the assertion to the existing security smoke/e2e if one exists, or extract the passkeys section into a tiny client sub-component (`PasskeysCard`) and unit-test that. Prefer the sub-component route — it keeps the page declarative and testable.

- [ ] **Step 4: Verify + commit**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm test && pnpm i18n:check && pnpm build`

```bash
git add src/app/\(app\)/settings/security/page.tsx tests/ messages/
git commit -m "feat(security): surface existing passkeys management from Security settings — Closes #68"
```

---

### Task 3: #69 — Recovery-codes management UI + minimal backend (feasible now, modest backend)

Backend exists for *generating* and *consuming* codes but not for *counting remaining* or *regenerating*. Add two small endpoints, then a UI section that shows "N of 10 recovery codes remaining" with a "Regenerate" action that returns a fresh set ONCE (invalidating the old set). Security-correct: never display previously-stored codes (they're hashed); regenerate replaces the whole set and surfaces plaintext exactly once.

**Files:**
- Modify: `src/lib/auth/two-factor.ts` (add `countRemainingRecoveryCodes`, `regenerateRecoveryCodes`)
- Create: `src/app/api/auth/2fa/recovery-codes/route.ts` (GET count, POST regenerate)
- Create: `src/components/security/recovery-codes-card.tsx`
- Modify: `src/app/(app)/settings/security/two-factor-card.tsx` (mount the card when 2FA is enabled) OR render it from the Security page when enabled
- Tests: `tests/lib/auth/recovery-codes.test.ts` (Testcontainers), `tests/api/auth/2fa-recovery-codes.test.ts`, `tests/components/security/recovery-codes-card.test.tsx`

- [ ] **Step 1: Lib — add count + regenerate (TDD, Testcontainers)**

Write `tests/lib/auth/recovery-codes.test.ts` first: enroll a user, assert `countRemainingRecoveryCodes` returns `RECOVERY_COUNT` (10); consume one via `verifySecondFactor` with a recovery code, assert count drops to 9; call `regenerateRecoveryCodes`, assert it returns 10 fresh plaintext codes, that the old codes no longer verify, and the count resets to 10. Then implement in `src/lib/auth/two-factor.ts`:

```ts
/** Count unused recovery codes for a user; 0 if 2FA isn't enrolled. */
export async function countRemainingRecoveryCodes(db: Db, userId: string): Promise<number> {
  const row = await getRow(db, userId);
  if (!row) return 0;
  const stored = (row.recoveryCodes ?? []) as StoredRecoveryCode[];
  return stored.filter((c) => c.usedAt === null).length;
}

/**
 * Replace the entire recovery-code set with a fresh batch. Returns plaintext
 * ONCE (never persisted in the clear). Requires 2FA to be enabled. Records an
 * audit event. The previous set is fully invalidated.
 */
export async function regenerateRecoveryCodes(
  db: Db,
  userId: string,
): Promise<string[] | null> {
  const row = await getRow(db, userId);
  if (!row?.enabledAt) return null;
  const codes = generateRecoveryCodes(RECOVERY_COUNT);
  const stored: StoredRecoveryCode[] = codes.map((code) => ({
    hash: hashRecoveryCode(code),
    usedAt: null,
  }));
  await db
    .update(schema.userTotp)
    .set({ recoveryCodes: stored })
    .where(eq(schema.userTotp.userId, userId));
  return codes;
}
```

Run: `source ~/.zshenv && pnpm vitest run tests/lib/auth/recovery-codes.test.ts` → green.

- [ ] **Step 2: API route (TDD)**

Write `tests/api/auth/2fa-recovery-codes.test.ts` (mock `@/lib/auth/config` with the `__set` session helper, per the project's route-test convention). Cases: unauthenticated → 401; GET returns `{ remaining: number }`; POST when 2FA disabled → 409/400 (cannot regenerate); POST when enabled → `{ recoveryCodes: string[] }` of length 10 and old codes invalidated. Then implement `src/app/api/auth/2fa/recovery-codes/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { auth } from '@/lib/auth/config';
import { countRemainingRecoveryCodes, regenerateRecoveryCodes } from '@/lib/auth/two-factor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const remaining = await countRemainingRecoveryCodes(getDb(), session.user.id);
  return NextResponse.json({ remaining });
}

export async function POST(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const codes = await regenerateRecoveryCodes(getDb(), session.user.id);
  if (!codes) return NextResponse.json({ error: '2fa_not_enabled' }, { status: 409 });
  return NextResponse.json({ recoveryCodes: codes });
}
```
Record an audit event for regenerate the same way `/api/webauthn/credentials/[credentialId]` does (`recordAudit` with action e.g. `mfa.recovery_codes_regenerated`, scoped to `getPrimaryWorkspaceId`) — match that file's pattern exactly.

- [ ] **Step 3: UI card (TDD, jsdom)**

`src/components/security/recovery-codes-card.tsx` (`'use client'`): on mount, GET the count → "N of 10 recovery codes remaining"; a **primary** "Regenerate codes" button (44px min height) that POSTs, then renders the returned plaintext codes in a monospace grid with a "save these now — shown once" warning (reuse the copy/markup pattern already in `two-factor-card.tsx` L94–101). Use a `window.confirm`-style guard before regenerating (regenerating invalidates the old set). All strings via `useT()`. Test asserts: renders the remaining count from a mocked fetch, clicking Regenerate (with confirm stubbed) shows the new codes, button is primary + ≥44px.

- [ ] **Step 4: Mount the card when 2FA is enabled**

Render `<RecoveryCodesCard />` from `two-factor-card.tsx`'s `enabled` branch (the `if (enabled) { return … }` block, ~L52). Only meaningful when 2FA is on, which matches the regenerate `409` guard.

- [ ] **Step 5: Verify + commit**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm test && pnpm i18n:check && pnpm build`

```bash
git add src/lib/auth/two-factor.ts src/app/api/auth/2fa/recovery-codes/ src/components/security/recovery-codes-card.tsx src/app/\(app\)/settings/security/two-factor-card.tsx tests/ messages/
git commit -m "feat(security): recovery-codes status + regenerate (single-use, audited) — Closes #69"
```

---

### Task 4: #70 — Sessions / sign-out-everywhere (FLAGGED LARGE — ship honest minimal slice, defer full feature)

> **SCOPE FLAG:** The session strategy is `jwt` (`src/lib/auth/config.ts` L102). There is **no server-side session store** to enumerate (the `sessions` table is inert under jwt — see CLAUDE.md). A true "active sessions list + revoke a specific device" requires net-new infra: a `users.token_version` column (or a JWT-id denylist table), threaded through the Auth.js `jwt`/`session`/`authorized` callbacks so existing JWTs are invalidated on bump. That is a meaningful auth change with its own migration, callback edits, and a dedicated security test suite. **It may slip to a follow-up release.** This task ships a *correct, non-fake* minimal slice now and files the heavy part as a tracked follow-up. **Do NOT fake a sessions table or render placeholder "devices" we can't actually revoke.**

**Files (minimal slice):**
- Modify: `src/app/(app)/settings/security/page.tsx` (add a "Sessions" section with a real sign-out action + honest explanation)
- (Follow-up, NOT this task): migration + `users.token_version` + auth callbacks + `/api/auth/sessions/revoke-all`.

- [ ] **Step 1: Diagnose + decide scope (write it down)**

Confirm `session: { strategy: 'jwt' }` and that no DB session rows are created at sign-in (grep `signIn`/`session` callbacks in `src/lib/auth/config.ts`). Conclude: a per-device list is not derivable from current state. Decide the minimal honest slice = a "Sign out of this browser" control + a one-line explanation that this Cairn instance uses stateless sessions, so remote sign-out everywhere is a planned feature. Record this in the commit body.

- [ ] **Step 2: Implement the minimal slice**

Add a "Sessions" `<section>` to the Security page with:
  - a real **Sign out** control wired to the existing sign-out route/action (find how the app currently signs out — e.g. a `signOut()` server action or the sidebar's sign-out used in #44; reuse it, don't invent a new one),
  - an honest explanatory line (i18n): sessions are token-based with a 30-day max age; "sign out everywhere" is coming in a follow-up.

All strings via i18n (server `createT` or escape-hatch as in Task 2). 44px targets, AA contrast.

- [ ] **Step 3: File the heavy follow-up**

Add a comment to the Round-2 index (`docs/superpowers/plans/2026-05-24-cairn-ux-audit-patches-11-round2-index.md`) under #70, OR post a GH issue comment, capturing the deferred design: `users.token_version` bump + `jwt`/`session` callback enforcement + `/api/auth/sessions/revoke-all` + audit + tests; note it likely lands in a follow-up release. (Use `gh issue comment 70 …` if the controller wants it on the issue.)

- [ ] **Step 4: Verify + commit**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm test && pnpm i18n:check && pnpm build`

```bash
git add src/app/\(app\)/settings/security/page.tsx messages/ docs/superpowers/plans/2026-05-24-cairn-ux-audit-patches-11-round2-index.md
git commit -m "feat(security): sign-out control + honest stateless-session note (revoke-all deferred) — refs #70"
```

> Note: commit trailer is `refs #70`, **not** `Closes #70` — the full feature is deferred. The controller decides whether to close #70 as "partial / follow-up filed" or leave it open.

---

### Task 5: #72 — Align notification email prefs with the real `notifications.type` enum

`NOTIFICATION_TYPES` in `src/lib/email/prefs.ts` lists only `mention` + `comment_reply`; the schema enum has five. Decide per-type whether an email pref is meaningful, then align the prefs list + the client UI labels. Hide types that have no email pathway rather than showing dead toggles.

**Decision (justify in commit body):**
- `mention`, `comment_reply` — keep (already wired; `notify-email.ts` sends these).
- `reminder`, `flashcards_due` — **investigate** whether `src/lib/email/notify-email.ts` / `digest.ts` actually send these. If yes, add them to `NOTIFICATION_TYPES` + labels. If no email pathway exists, **omit** them (don't show an unwired toggle) and leave a code comment + commit note that they're in-app-only for now.
- `upgrade_available` — admin/release-watch notification; **omit** from per-user email prefs (it targets owners/admins via a different path).

**Files:**
- Modify: `src/lib/email/prefs.ts` (`NOTIFICATION_TYPES`)
- Modify: `src/app/api/notifications/prefs/route.ts` (the `z.enum(NOTIFICATION_TYPES)` follows automatically — confirm)
- Modify: `src/components/settings/notification-prefs.tsx` (`NotificationType` union + `TYPE_LABELS`)
- Tests: `tests/lib/email/prefs.test.ts` (extend), `tests/components/notification-prefs.test.tsx` (extend/create)

- [ ] **Step 1: Investigate email pathways for `reminder` / `flashcards_due`**

Read `src/lib/email/notify-email.ts` and `src/lib/email/digest.ts`. Determine which `notifications.type` values can actually produce an email. Grep for `'reminder'` / `'flashcards_due'` send paths. Write the finding into the commit body — this is the gate for what gets added vs omitted.

- [ ] **Step 2: Update the canonical type list (TDD)**

Extend `tests/lib/email/prefs.test.ts` to assert `getEmailPrefs` returns one entry per *emailable* type (the new set). Then update `NOTIFICATION_TYPES` in `src/lib/email/prefs.ts` to the decided set. The route's `z.enum(NOTIFICATION_TYPES)` and `getEmailPrefs` map both key off this constant — no other route edits needed (confirm by reading the route).

- [ ] **Step 3: Align the client UI**

In `src/components/settings/notification-prefs.tsx`: widen the local `NotificationType` union and `TYPE_LABELS` to match `NOTIFICATION_TYPES` exactly (import the type from `@/lib/email/prefs` instead of re-declaring, to keep them from drifting — this is the root cause of #72). Add i18n labels for any new type. Test asserts a row renders for each emailable type.

- [ ] **Step 4: Verify + commit**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm test && pnpm i18n:check && pnpm build`

```bash
git add src/lib/email/prefs.ts src/app/api/notifications/prefs/route.ts src/components/settings/notification-prefs.tsx tests/ messages/
git commit -m "fix(notifications): align email prefs with real notification types, hide unwired ones — Closes #72"
```

---

### Task 6: #73 + #74 — Verify & harden SMTP-disabled handling (toggles disabled + neutral banner)

Investigation shows `src/components/settings/notification-prefs.tsx` **already**: reads `emailEnabled` from the prefs GET, disables email-bearing `<Button>`s when SMTP is unset (`disabled = !smtpEnabled && c.emailEnabled`, L126), and renders an **amber** info banner (L108–113), not red. So both #73 and #74 are largely already satisfied. This task **verifies with tests** and hardens: (a) ensure the disabled state is perceivable + has an explanation (tooltip/`title`/`aria-describedby`, not color-only), (b) confirm banner uses neutral/info amber (or blue) tokens consistently in dark mode, (c) route the banner copy through i18n.

**Files:**
- Modify: `src/components/settings/notification-prefs.tsx`
- Test: `tests/components/notification-prefs.test.tsx` (extend/create)

- [ ] **Step 1: Diagnose why #73/#74 were filed despite the code already handling it**

Read `notification-prefs.tsx` and confirm the disable + amber-banner logic. The likely reasons they were filed: (i) the audit was on a build where the prefs API didn't yet return `emailEnabled`, or (ii) the disabled state was visually subtle / had no textual reason, or (iii) the banner read as red in a prior revision. Record which applies. **If the current code is already correct, the task is to lock it in with tests + a textual disabled-reason + i18n** so it can't regress — not to rewrite it.

- [ ] **Step 2: Write the failing/locking test (jsdom)**

Mock `fetch('/api/notifications/prefs')` to return `{ prefs: […], emailEnabled: false }`. Assert:
  - the "Email" and "Daily digest" buttons are `disabled`,
  - each disabled email-bearing button carries an explanatory `title`/`aria-describedby` referencing SMTP,
  - the banner is present and uses the amber/info classes (`bg-amber-50` / `text-amber-900` / dark variants) — i.e. **not** `bg-destructive`/`text-destructive`/red tokens.
Then mock `emailEnabled: true` and assert the buttons are enabled and the banner is absent.

- [ ] **Step 3: Harden**

Add a `title` (and/or `aria-describedby` pointing at the banner id) on the disabled email-bearing buttons so the reason is non-color, screen-reader-available. Move the banner copy and the disabled-reason into i18n keys (`notifications.smtp.disabledBanner`, `notifications.smtp.disabledReason`). Keep the amber tokens (they already satisfy AA against the foreground); if switching to blue/info is preferred, use the same token family the app uses elsewhere for info — read globals.css before introducing new color tokens.

- [ ] **Step 4: Verify + commit**

Run: `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm test && pnpm i18n:check && pnpm build`

```bash
git add src/components/settings/notification-prefs.tsx tests/components/notification-prefs.test.tsx messages/
git commit -m "fix(notifications): SMTP-off email toggles disabled w/ reason + neutral info banner — Closes #73 Closes #74"
```

---

### Task 7: #29 (REOPENED) — `/notifications` From/To still "native date inputs"

> **Diagnose-first (required).** Round-1 P01 (commit `734bb37`) swapped the raw `<input type="date">` in `src/components/notifications/page-list.tsx` to `<DateField>`. The DateField IS present today (page-list.tsx L213 + L225). **Why did the audit reopen it?** Because `src/components/ui/date-field.tsx` renders `<Input type="date" …>` — a **native** date input under the hood. The round-1 fix only restyled the *field box* (border/colors); the **calendar picker popup, the spinner segments, and the native dropdown glyph are still the OS-native control**, which is exactly what "still native date inputs" describes. The styling swap did not replace the native picker.

**Decision:** make `DateField` a *truly* custom-rendered control: a `<Button>`-style trigger that opens a themed calendar in a `Popover` (radix-ui), formatting/parsing ISO dates ourselves. This removes the native picker entirely and fixes #29 for **every** call site (notifications From/To, my-tasks due in P19, and any other DateField consumer) in one place.

**Files:**
- Modify: `src/components/ui/date-field.tsx` (replace native input with Popover + calendar)
- Possibly create: `src/components/ui/calendar.tsx` (themed month grid) if none exists — **check first** (`ls src/components/ui | grep -i calendar`); the project uses `radix-ui` + may already have a calendar or `react-day-picker`. Reuse before creating.
- Tests: `tests/components/ui/date-field.test.tsx` (rewrite to assert non-native behavior), `tests/components/notifications-page-list.test.tsx` (existing date-filter behavior must still pass)

- [ ] **Step 1: Confirm the diagnosis in code**

Read `src/components/ui/date-field.tsx` — confirm it renders `<Input type="date">`. Read `src/components/notifications/page-list.tsx` L213–235 — confirm From/To use `DateField`. Run any existing date-field test and note it asserts `input.type === 'date'` (the round-1 test in P01 explicitly asserted `input.type).toBe('date')` — that test *enforced* the native input, which is why the regression "held" at the test level while failing the visual audit). Record this.

- [ ] **Step 2: Decide calendar substrate**

`ls src/components/ui` and grep for `calendar`/`day-picker`/`react-day-picker` in `package.json`. If a themed calendar/popover exists, build on it. If not, the lightest correct path is a `radix-ui` `Popover` trigger + a small self-rendered month grid (buttons per day) — no native `type="date"`. Keep the public `DateField` props (`label`, `value`, `onChange(value: string)`, `id`, `className`, `hideLabel`) **unchanged** so call sites don't move. `value`/`onChange` stay ISO `YYYY-MM-DD` strings.

- [ ] **Step 3: Rewrite `DateField` (TDD)**

Rewrite `tests/components/ui/date-field.test.tsx` first to assert the *new* contract: the trigger is a `button` (not `input[type=date]`) showing the formatted value or a placeholder; opening it reveals a dialog/grid; picking a day calls `onChange` with an ISO string; the label is associated for a11y; trigger is ≥44px. Implement `DateField` as a Popover-based control. Keep `hideLabel`/`sr-only` semantics and the dark-mode correctness (now trivially correct since it's all themed tokens, no `color-scheme` hack needed).

- [ ] **Step 4: Confirm notifications still filters correctly**

The From/To `onChange` in `page-list.tsx` converts `YYYY-MM-DD` → ISO via `new Date(`${next}T00:00:00Z`).toISOString()`. Since `DateField` still emits `YYYY-MM-DD`, **no page-list change is needed** — but run/extend the notifications list test to prove the date filter still drives `applyFilter` with the expected ISO value.

- [ ] **Step 5: Verify + commit**

Run: `source ~/.zshenv && pnpm vitest run tests/components/ui/date-field.test.tsx tests/components/notifications-page-list.test.tsx && pnpm lint && pnpm typecheck && pnpm test && pnpm build`

```bash
git add src/components/ui/date-field.tsx src/components/ui/calendar.tsx tests/components/ui/date-field.test.tsx tests/components/notifications-page-list.test.tsx
git commit -m "fix(notifications): replace native date picker with themed Popover calendar (fixes all DateField sites) — Closes #29"
```

> **Cross-plan note:** this rewrites the shared `DateField`, which P19 (#27 /my-tasks due) also depends on. Sequence Task 7 **before** P19's #27 re-fix, or P19 references this commit. Flag to the controller.

---

### Task 8: #30 (REOPENED) — Mentions/Replies pills still "lack active state"

> **Diagnose-first (required).** Round-1 P06 (commit `0303924`) added `aria-pressed` + a `bg-primary text-primary-foreground` filled style to the type pills in `src/components/notifications/page-list.tsx` (L186–209), plus a test (`tests/components/notifications-pills.test.tsx`). Both ARE present today. **Why reopened?** Re-investigate these candidates and confirm which holds:
> 1. **Hydration of initial filter:** the active state is driven by `filter.type?.includes(t)`. On a fresh load with a `?type=` URL param, does `initialFilter.type` actually arrive populated so the pill renders pressed on first paint? If the server passes `initialFilter` without parsing `type` from the query, the pill looks inactive until the user clicks. Check `src/app/(app)/notifications/page.tsx` (how `initialFilter` is built from `searchParams`).
> 2. **Color-only signal (WCAG 1.4.1):** the active state is conveyed *only* by fill color. The audit may require a non-color affordance (a check icon, a border, or `aria-pressed` reflected visually beyond hue) — the existing test only checks classes, not perceivability.
> 3. **Contrast:** confirm `bg-primary`/`text-primary-foreground` and the inactive `text-muted-foreground` both meet AA in light + dark.

**Files:**
- Modify: `src/components/notifications/page-list.tsx`
- Possibly modify: `src/app/(app)/notifications/page.tsx` (if cause #1 — parse `type` into `initialFilter`)
- Test: `tests/components/notifications-pills.test.tsx` (extend), and a render test for initial pressed state from `initialFilter`

- [ ] **Step 1: Reproduce + pinpoint**

Read `src/app/(app)/notifications/page.tsx` and confirm how `initialFilter.type` is derived from `searchParams.type` (it may be a single string vs array mismatch — `?type=mention&type=comment_reply` must become `['mention','comment_reply']`). Read the pill block in `page-list.tsx`. Decide which of the three causes is real (likely #1 array-parse and/or #2 color-only). Write the diagnosis in the commit body.

- [ ] **Step 2: Fix the real cause(s)**

- If #1: ensure `initialFilter.type` is parsed from `searchParams` as a string[] (handle single + multi), so a shared/refreshed URL renders the correct pills pressed on first paint. Add a render test passing `initialFilter={{ type: ['mention'] }}` asserting Mentions `aria-pressed="true"` on initial render (the existing test already does this for the client toggle — extend it to assert the *initial server* state path too).
- If #2: add a non-color affordance to the active pill — render a small `<Check>`/dot when `selected`, and/or a distinct border, so the state is perceivable without color. Keep `aria-pressed`.
- Ensure ≥44px touch target (the pills are `px-3 py-1` — bump to meet 44px min, e.g. `min-h-11`, matching the touch-target convention used elsewhere in this branch).

- [ ] **Step 3: Verify + commit**

Run: `source ~/.zshenv && pnpm vitest run tests/components/notifications-pills.test.tsx && pnpm lint && pnpm typecheck && pnpm test && pnpm build`

```bash
git add src/components/notifications/page-list.tsx src/app/\(app\)/notifications/page.tsx tests/components/notifications-pills.test.tsx
git commit -m "fix(notifications): pill active state survives initial URL filter + non-color affordance + 44px — Closes #30"
```

---

## Self-Review

- **Coverage:** #71 (Task 1, full), #68 (Task 2, link existing built page), #69 (Task 3, small backend + UI), #70 (Task 4, **honest minimal slice; full feature flagged + deferred**, `refs` not `Closes`), #72 (Task 5, align to enum), #73+#74 (Task 6, verify/harden — largely already correct), reopened #29 (Task 7, root-cause = native picker inside `DateField`), reopened #30 (Task 8, root-cause = initial-filter hydration and/or color-only). ✓
- **Feasible-now vs flagged-large:** #71, #68, #69, #72, #73, #74 are all feasible in this branch. **#70 is the one heavy item** — only a minimal honest slice ships now; the `token_version`/JWT-revocation full feature is deferred to a follow-up release. ✓
- **Security correctness (no faked controls):** #70 explicitly refuses to render a fake sessions list under jwt; #69 regenerate invalidates the old set and surfaces plaintext once; recovery codes stay hashed. ✓
- **i18n:** every new user-facing string is routed through `t()` / `createT` with keys added to `messages/{en,es,ar}.json`, gated by `pnpm i18n:check`; RSC-string escape-hatch documented where server i18n plumbing is heavy. ✓
- **WCAG AA + 44px:** new/changed interactive controls (pills, DateField trigger, recovery/regenerate buttons, passkeys link) carry ≥44px targets and non-color affordances; contrast verified against existing tokens. ✓
- **Gate:** every task ends on `lint && typecheck && test` (+ `build` for UI/routes, + `i18n:check` for new strings), one commit per issue with `Closes #NN` (except #70 → `refs #70`). ✓
- **Cross-plan dependency:** Task 7 rewrites the shared `DateField`; must land before P19's #27 /my-tasks re-fix. Flagged. ✓
- **Reopened diagnose-first:** Tasks 7 and 8 each begin with an explicit "why round-1 didn't hold" investigation step before touching code. ✓
