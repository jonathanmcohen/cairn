# P30 — Publish / Share Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix the three publish/share UX defects on the page "…" menu — the cramped share-settings sub-form (#120), the no-confirmation "Publish to web" flip (#118), and the password input with no show/hide toggle (#119) — by moving share settings into a dedicated **Share modal**, adding a publish confirmation step, and pairing the password field with a themed input + eye toggle.

**Architecture:** Today `src/components/page-menu.tsx` renders a hand-rolled `role="dialog"` *popover* (no focus trap, no backdrop; Esc + focus-restore only). Inside its published branch it mounts `src/components/pages/share-panel.tsx` (`SharePanel`), a column of cramped controls (`text-xs` inputs, no labels-as-controls, native `type=date`) that PATCHes `/api/pages/<id>/share` on every change. The fix is to **lift the share settings out of the popover into a real focus-trap modal** built on the `ui/dialog.tsx` primitive, give the form room (labelled fields, ≥44px controls), gate the public flip behind a confirm dialog, and add an eye toggle to the password input. The popover becomes a thin launcher: "Manage sharing…" opens the Share modal; "Publish to web" / "Unpublish" stay on the popover but publish now routes through a confirm step.

**Modal vs. settings sub-tab — DECISION: dedicated Share modal.** A settings sub-tab was rejected: there is no per-page settings tab surface in Cairn (page settings live entirely in the PageMenu popover), so a sub-tab would mean inventing a new navigation surface for a 4-field form. A modal is the lighter, conventional fix, gives the form the room #120 asks for, reuses the `ui/dialog.tsx` focus-trap primitive (satisfies the keyboard-accessibility constraint for free), and matches the modal direction already set by plan `-21-` (`WorkspaceCreateDialog`). The publish-confirm is a second, smaller modal built on the same primitive.

**Tech Stack:** React 19, `radix-ui` 1.4.3 (Dialog primitive), Tailwind v4, `cn()` from `src/lib/utils.ts`, i18n via `useT()` (`src/lib/i18n/provider`), `lucide-react` icons.

**Covers:** GH #118 (publish confirmation), #119 (password show/hide), #120 (share-settings modal).

---

## ⚠️ Dependency: `ui/dialog.tsx` from plan `-21-workspace-flows.md`

This plan **requires** the themed `Dialog` primitive (`src/components/ui/dialog.tsx`) introduced by **Task 3 of `2026-05-24-cairn-ux-audit-patches-21-workspace-flows.md`** (exports `Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogPortal, DialogTitle, DialogTrigger`; `DialogContent` takes an i18n'd `closeLabel`). It is a radix-ui `Dialog` wrapper that provides Esc dismiss, outside-click dismiss, focus trap, and focus restoration — i.e. the WCAG-correct modal the constraints demand.

**As of this plan's writing, `src/components/ui/dialog.tsx` does NOT exist** (the `src/components/ui/` dir holds `avatar, button, card, date-field, form, input, label, select, sonner` — no `dialog`). Resolution order for the implementer:

- [ ] **Pre-flight: check for `src/components/ui/dialog.tsx`.** Run `source ~/.zshenv && ls src/components/ui/dialog.tsx`.
  - **If it exists** (plan `-21-` already landed): skip to Task 1; just import from it.
  - **If it does NOT exist:** build it first via **Task 0** below (copied verbatim from `-21-` Task 3 so this plan is self-contained), then continue. If `-21-` lands later it will no-op (same file, same exports) — coordinate so only one plan commits `dialog.tsx`.

---

### Task 0 (conditional): Add the themed `Dialog` UI primitive (radix-ui)

> Only run this task if the pre-flight check found no `src/components/ui/dialog.tsx`. Verbatim from plan `-21-` Task 3 — keep in sync.

**Files:**
- Create: `src/components/ui/dialog.tsx`
- Test: `tests/components/ui/dialog.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

afterEach(cleanup);

describe('<Dialog>', () => {
  it('renders an accessible dialog with a title when open', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New workspace</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'New workspace' });
    expect(dialog).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/ui/dialog.test.tsx`
Expected: FAIL — module `@/components/ui/dialog` not found.

- [ ] **Step 3: Implement the primitive**

```tsx
'use client';

import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import * as React from 'react';
import { cn } from '@/lib/utils';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = 'DialogOverlay';

const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { closeLabel?: string }
>(({ className, children, closeLabel = 'Close', ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 grid w-full max-w-[28rem] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-popover p-6 text-popover-foreground shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out',
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        aria-label={closeLabel}
        className="absolute right-4 top-4 flex min-h-11 min-w-11 items-center justify-center rounded-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = 'DialogContent';

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1.5 text-left', className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />
  );
}

const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn('text-base font-semibold', className)} {...props} />
));
DialogTitle.displayName = 'DialogTitle';

const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
));
DialogDescription.displayName = 'DialogDescription';

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `source ~/.zshenv && pnpm vitest run tests/components/ui/dialog.test.tsx`
Expected: PASS. If `bg-popover`/`popover-foreground` tokens are undefined, grep `src/app/globals.css` `@theme` to confirm before touching anything (P01 confirmed them present for the Select primitive).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/dialog.tsx tests/components/ui/dialog.test.tsx
git commit -m "feat(ui): add themed Dialog primitive (radix-ui) — refs #120"
```

---

### Task 1: Add the `PasswordInput` UI primitive with a show/hide eye toggle (#119)

There is **no existing show/hide password pattern** in the codebase (grep for `showPassword`/`EyeOff` finds none), so this primitive establishes it. Build it as a reusable wrapper around the shadcn `Input` so the share-password field (Task 2) and any future password field reuse it.

**Files:**
- Create: `src/components/ui/password-input.tsx`
- Test: `tests/components/ui/password-input.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PasswordInput } from '@/components/ui/password-input';

afterEach(cleanup);

describe('<PasswordInput>', () => {
  it('starts masked and toggles to text when the eye button is pressed', () => {
    render(<PasswordInput aria-label="Link password" showLabel="Show password" hideLabel="Hide password" />);
    const input = screen.getByLabelText('Link password') as HTMLInputElement;
    expect(input.type).toBe('password');
    const toggle = screen.getByRole('button', { name: 'Show password' });
    fireEvent.click(toggle);
    expect(input.type).toBe('text');
    // the toggle is now the "hide" affordance and reports pressed state
    const pressed = screen.getByRole('button', { name: 'Hide password' });
    expect(pressed.getAttribute('aria-pressed')).toBe('true');
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `source ~/.zshenv && pnpm vitest run tests/components/ui/password-input.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
'use client';

import { Eye, EyeOff } from 'lucide-react';
import * as React from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type PasswordInputProps = Omit<React.ComponentProps<'input'>, 'type'> & {
  /** Accessible name for the reveal action (visible password is hidden). */
  showLabel: string;
  /** Accessible name for the hide action (visible password is shown). */
  hideLabel: string;
};

/**
 * #119 — text input with an in-field show/hide eye toggle. Defaults to masked.
 * The toggle is a real <button> with `aria-pressed`, a discernible name that
 * flips with state, and a ≥44px hit target; the eye glyphs are aria-hidden.
 */
export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, showLabel, hideLabel, ...props }, ref) => {
    const [visible, setVisible] = React.useState(false);
    return (
      <div className="relative">
        <Input
          ref={ref}
          type={visible ? 'text' : 'password'}
          // pad-right so text never sits under the toggle button
          className={cn('min-h-11 pr-11', className)}
          {...props}
        />
        <button
          type="button"
          aria-pressed={visible}
          aria-label={visible ? hideLabel : showLabel}
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 flex min-h-11 min-w-11 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring rounded-md"
        >
          {visible ? (
            <EyeOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Eye className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = 'PasswordInput';
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `source ~/.zshenv && pnpm vitest run tests/components/ui/password-input.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/password-input.tsx tests/components/ui/password-input.test.tsx
git commit -m "feat(ui): add PasswordInput with show/hide eye toggle — refs #119"
```

---

### Task 2: Rebuild `SharePanel` as a roomy, labelled form inside a Share modal (#120, #119)

Convert `SharePanel` from the cramped popover column into the body of a dedicated modal: labelled fields, ≥44px controls, the themed `DateField` for expiry, and the `PasswordInput` for the set-password field. **Preserve every existing behaviour** — the per-change PATCH to `/api/pages/<id>/share`, the `rotatePassword` flow (16-char base64 → PATCH → clipboard, inline-reveal fallback), the remove/rotate buttons, and the status line. The existing test `tests/components/pages/share-panel-rotate.test.tsx` must keep passing.

**Files:**
- Modify: `src/components/pages/share-panel.tsx`
- Create: `src/components/pages/share-dialog.tsx`
- Test: `tests/components/pages/share-dialog.test.tsx`
- Keep passing: `tests/components/pages/share-panel-rotate.test.tsx`

- [ ] **Step 1: Read both files in full first**

Read `src/components/pages/share-panel.tsx` and `tests/components/pages/share-panel-rotate.test.tsx`. Note the real prop names (`pageId`, `initialAllowDuplication`, `initialHasPassword`, `initialExpiresAt`), the `patch()` helper, the `rotatePassword()` impl, and the state setters (`allowDuplication`, `hasPassword`, `password`, `expiresAt`, `status`). The rotate test renders `<SharePanel pageId="p1" initialHasPassword />` and clicks the button named `/rotate password/i` — keep that button and the `Rotated. New password:` fallback string intact (it is matched by regex, not the i18n key, so the fallback text must still contain that phrase; key it but the en value must read `Rotated. New password: {password}`).

- [ ] **Step 2: Rework `SharePanel`'s JSX — roomy labelled form, i18n, themed controls**

Keep the component's logic (state, `patch`, `rotatePassword`) unchanged. Replace ONLY the returned JSX so it is a labelled vertical form suitable for a modal body (drop the `px-3 py-2 text-sm` popover padding — the modal supplies padding). Use the real i18n hook (`const t = useT();`) and these patterns:

```tsx
'use client';

import { useState } from 'react';
import { DateField } from '@/components/ui/date-field';
import { PasswordInput } from '@/components/ui/password-input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useT } from '@/lib/i18n/provider';
// …existing props + state + patch() + rotatePassword() unchanged…

  return (
    <div className="space-y-5">
      {/* Allow duplication */}
      <div className="flex items-start gap-3">
        <input
          id="share-allow-dup"
          type="checkbox"
          className="mt-1 h-4 w-4"
          checked={allowDuplication}
          onChange={(e) => {
            const v = e.target.checked;
            setAllowDuplication(v);
            void patch({ allowDuplication: v });
          }}
        />
        <Label htmlFor="share-allow-dup" className="font-normal">
          <span className="block font-medium">{t('share.allowDuplication.label')}</span>
          <span className="block text-xs text-muted-foreground">
            {t('share.allowDuplication.hint')}
          </span>
        </Label>
      </div>

      {/* Link password */}
      <div className="space-y-2">
        <Label htmlFor="share-password">{t('share.password.label')}</Label>
        {hasPassword ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void patch({ password: null }).then((ok) => {
                  if (ok) setHasPassword(false);
                });
              }}
            >
              {t('share.password.remove')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={t('share.password.rotate')}
              onClick={() => {
                void rotatePassword();
              }}
            >
              {t('share.password.rotate')}
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <PasswordInput
              id="share-password"
              aria-label={t('share.password.label')}
              showLabel={t('share.password.show')}
              hideLabel={t('share.password.hide')}
              placeholder={t('share.password.placeholder')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button
              type="button"
              disabled={!password}
              onClick={() => {
                if (!password) return;
                void patch({ password }).then((ok) => {
                  if (ok) {
                    setHasPassword(true);
                    setPassword('');
                  }
                });
              }}
            >
              {t('share.password.set')}
            </Button>
          </div>
        )}
      </div>

      {/* Expiry */}
      <div className="space-y-2">
        <div className="flex items-end gap-2">
          <DateField
            label={t('share.expires.label')}
            value={expiresAt}
            onChange={setExpiresAt}
            className="flex-1"
          />
          <Button
            type="button"
            onClick={() => {
              void patch({
                expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
              });
            }}
          >
            {t('share.expires.save')}
          </Button>
        </div>
      </div>

      {status && (
        <div aria-live="polite" className="text-xs text-muted-foreground">
          {status}
        </div>
      )}
    </div>
  );
```

Notes for the implementer:
- The `status` strings currently come from `patch()`/`rotatePassword()` as English literals (`'Saved'`, `'Error'`, `'Rotated + copied to clipboard'`, `` `Rotated. New password: ${next}` ``). i18n these by replacing the literals with `t('share.status.saved')`, `t('share.status.error')`, `t('share.status.rotatedCopied')`, and `t('share.status.rotatedReveal', { password: next })`. **The en value for `share.status.rotatedReveal` MUST be `Rotated. New password: {password}`** so the existing rotate test's `/Rotated\. New password:/` regex still matches.
- `DateField` (`src/components/ui/date-field.tsx`) is already themed/dark-safe and takes `{ label, value, onChange, className }`; pass `expiresAt` (already a `yyyy-mm-dd` slice in state) directly.
- Keep `aria-live="polite"` on the status so screen-reader users hear save confirmations.

- [ ] **Step 3: Build the `ShareDialog` wrapper**

Create `src/components/pages/share-dialog.tsx` — a modal that wraps `SharePanel`, plus the public link row (`/p/<slug>` + copy) lifted out of the popover so all share controls live in one roomy surface:

```tsx
'use client';

import { useState } from 'react';
import { SharePanel } from '@/components/pages/share-panel';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useT } from '@/lib/i18n/provider';

type ShareDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageId: string;
  slug: string | null;
  initialAllowDuplication?: boolean;
  initialHasPassword?: boolean;
  initialExpiresAt?: string | null;
};

export function ShareDialog({
  open,
  onOpenChange,
  pageId,
  slug,
  initialAllowDuplication,
  initialHasPassword,
  initialExpiresAt,
}: ShareDialogProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  function copyUrl() {
    if (!slug) return;
    const url = `${window.location.origin}/p/${slug}`;
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('common.close')} className="max-w-[32rem]">
        <DialogHeader>
          <DialogTitle>{t('share.title')}</DialogTitle>
          <DialogDescription>{t('share.description')}</DialogDescription>
        </DialogHeader>

        {slug && (
          <div className="space-y-1">
            <div className="truncate text-sm text-muted-foreground">/p/{slug}</div>
            <Button type="button" variant="outline" size="sm" onClick={copyUrl}>
              {copied ? t('share.linkCopied') : t('share.copyLink')}
            </Button>
          </div>
        )}

        <SharePanel
          pageId={pageId}
          initialAllowDuplication={initialAllowDuplication}
          initialHasPassword={initialHasPassword}
          initialExpiresAt={initialExpiresAt}
        />
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Write a test for `ShareDialog`**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ShareDialog } from '@/components/pages/share-dialog';
import { I18nProvider } from '@/lib/i18n/provider';
import en from '../../../messages/en.json';

afterEach(cleanup);

function renderOpen() {
  return render(
    <I18nProvider locale="en" messages={en as Record<string, string>}>
      <ShareDialog open onOpenChange={() => {}} pageId="p1" slug="my-page" />
    </I18nProvider>,
  );
}

describe('<ShareDialog>', () => {
  it('renders a focus-trap dialog titled "Share" with the public link', () => {
    renderOpen();
    const dialog = screen.getByRole('dialog', { name: en['share.title'] });
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('/p/my-page');
  });
});
```

Adjust the relative `messages/en.json` import depth to match the test file location (`tests/components/pages/` → `../../../messages/en.json`).

- [ ] **Step 5: Run the suite, confirm green**

Run: `source ~/.zshenv && pnpm vitest run tests/components/pages/share-dialog.test.tsx tests/components/pages/share-panel-rotate.test.tsx`
Expected: both PASS. If the rotate test fails on the status text, re-check the `share.status.rotatedReveal` en value contains `Rotated. New password: {password}`.

- [ ] **Step 6: Commit**

```bash
git add src/components/pages/share-panel.tsx src/components/pages/share-dialog.tsx tests/components/pages/share-dialog.test.tsx
git commit -m "feat(share): roomy labelled Share modal + themed password/date controls — Closes #120 Closes #119"
```

---

### Task 3: Add a publish confirmation step (#118)

`PageMenu.publish()` currently POSTs `/api/pages/<id>/publish` immediately on click, flipping the page public with no warning. Add a confirm modal: "Publish to web" opens it; only "Publish" inside the modal performs the POST. **Unpublish stays immediate** (no confirm) per the spec. Build the confirm on the same `ui/dialog.tsx` primitive so it is a real focus-trap dialog (Esc, focus restore) — satisfying the keyboard-accessibility constraint.

**Files:**
- Modify: `src/components/page-menu.tsx`
- Test: `tests/components/page-menu-publish-confirm.test.tsx`

- [ ] **Step 1: Read `src/components/page-menu.tsx` in full**

Note the real handlers (`publish`, `unpublish`, `copyUrl`), state (`published`, `slug`, `copied`, `open`), the `useActionAllowed('share')` gate (`shareAllowed`), and that the popover already wires Esc → close + focus-restore to `triggerRef`.

- [ ] **Step 2: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageMenu } from '@/components/page-menu';
import { I18nProvider } from '@/lib/i18n/provider';
import en from '../../messages/en.json';

// useActionAllowed must return true so the publish button is enabled
vi.mock('@/components/pwa/offline-context', () => ({ useActionAllowed: () => true }));

const fetchSpy = vi.fn();

beforeEach(() => {
  fetchSpy.mockReset();
  fetchSpy.mockResolvedValue(new Response(JSON.stringify({ slug: 's1' }), { status: 200 }));
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function open() {
  render(
    <I18nProvider locale="en" messages={en as Record<string, string>}>
      <PageMenu pageId="p1" initialPublished={false} />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: en['pageMenu.menu'] }));
}

describe('PageMenu publish confirmation (#118)', () => {
  it('does NOT publish on the menu click — opens a confirm dialog first', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: en['pageMenu.publish'] }));
    // confirm dialog is shown, no fetch yet
    expect(screen.getByRole('dialog', { name: en['publishConfirm.title'] })).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('publishes only after confirming in the dialog', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: en['pageMenu.publish'] }));
    fireEvent.click(screen.getByRole('button', { name: en['publishConfirm.confirm'] }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/api/pages/p1/publish', { method: 'POST' }));
  });
});
```

(If `PageMenu`'s existing copy is not yet i18n'd, the test labels assume Task 4 has keyed `pageMenu.menu`/`pageMenu.publish`. Run Task 4's string additions before this test, or land them together.)

- [ ] **Step 3: Implement the confirm modal in `PageMenu`**

- Add state: `const [confirmPublishOpen, setConfirmPublishOpen] = useState(false);` and `const [shareOpen, setShareOpen] = useState(false);` (the latter is for Task 4).
- Change the "Publish to web" button's `onClick` from `() => void publish()` to `() => { setConfirmPublishOpen(true); setOpen(false); }` (close the popover, open the confirm).
- Leave `unpublish`'s button calling `() => void unpublish()` directly (immediate, no confirm).
- Render a confirm `Dialog` (sibling to the existing `SaveAsTemplateDialog`, outside the popover so it survives the popover closing):

```tsx
<Dialog open={confirmPublishOpen} onOpenChange={setConfirmPublishOpen}>
  <DialogContent closeLabel={t('common.close')}>
    <DialogHeader>
      <DialogTitle>{t('publishConfirm.title')}</DialogTitle>
      <DialogDescription>{t('publishConfirm.body')}</DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <Button type="button" variant="ghost" onClick={() => setConfirmPublishOpen(false)}>
        {t('common.cancel')}
      </Button>
      <Button
        type="button"
        onClick={() => {
          setConfirmPublishOpen(false);
          void publish();
        }}
      >
        {t('publishConfirm.confirm')}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

Add imports: `useT` from `@/lib/i18n/provider`, and `Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle` from `@/components/ui/dialog`.

- [ ] **Step 4: Verify**

Run: `source ~/.zshenv && pnpm vitest run tests/components/page-menu-publish-confirm.test.tsx`
Expected: PASS — first click opens the dialog and fires no fetch; the confirm button triggers the POST.

- [ ] **Step 5: Commit**

```bash
git add src/components/page-menu.tsx tests/components/page-menu-publish-confirm.test.tsx
git commit -m "feat(share): confirm before publishing a page to the web — Closes #118"
```

---

### Task 4: Wire the Share modal into `PageMenu` + i18n all new strings

Replace the inline `SharePanel` mount (and the duplicated `/p/<slug>` + copy row) in the published branch with a "Manage sharing…" launcher that opens the `ShareDialog`. Add all new i18n keys to `messages/en.json`, `messages/es.json`, `messages/ar.json`.

**Files:**
- Modify: `src/components/page-menu.tsx`
- Modify: `messages/en.json`, `messages/es.json`, `messages/ar.json`
- Test: `tests/components/page-menu-share.test.tsx`

- [ ] **Step 1: Replace the published-branch share UI with a launcher**

In the `published` branch of the popover, remove the inline `<SharePanel … />` block and the `/p/<slug>` + "Copy public link" `<div>` (both move into `ShareDialog`). Keep the "Unpublish" button. Add a launcher button:

```tsx
<button
  type="button"
  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
  disabled={!shareAllowed}
  onClick={() => {
    setShareOpen(true);
    setOpen(false);
  }}
>
  {t('share.manage')}
</button>
```

Render `<ShareDialog open={shareOpen} onOpenChange={setShareOpen} pageId={pageId} slug={slug} initialAllowDuplication={initialAllowDuplication} initialHasPassword={initialHasPassword} initialExpiresAt={initialExpiresAt} />` as a sibling to the confirm dialog (outside the popover). Import `ShareDialog` from `@/components/pages/share-dialog`. Remove the now-unused direct `SharePanel` import and the `copied`/`copyUrl` popover state if nothing else uses them (the copy logic now lives in `ShareDialog`).

- [ ] **Step 2: i18n the static PageMenu strings used by tests + the new strings**

Key the menu/publish labels the publish-confirm test relies on, and add every new string. Add to `messages/en.json` (flat dot-keyed `Record<string,string>`):

```jsonc
{
  "common.close": "Close",
  "common.cancel": "Cancel",

  "pageMenu.menu": "Page menu",
  "pageMenu.publish": "Publish to web",
  "pageMenu.unpublish": "Unpublish",

  "publishConfirm.title": "Publish to web",
  "publishConfirm.body": "Anyone with the link can view this page. Continue?",
  "publishConfirm.confirm": "Publish",

  "share.manage": "Manage sharing…",
  "share.title": "Share",
  "share.description": "Control who can view and duplicate this page.",
  "share.copyLink": "Copy public link",
  "share.linkCopied": "Copied!",
  "share.allowDuplication.label": "Allow duplication",
  "share.allowDuplication.hint": "Visitors can copy this page into their own workspace.",
  "share.password.label": "Link password",
  "share.password.placeholder": "Set a password",
  "share.password.set": "Set",
  "share.password.remove": "Remove password",
  "share.password.rotate": "Rotate password",
  "share.password.show": "Show password",
  "share.password.hide": "Hide password",
  "share.expires.label": "Expires",
  "share.expires.save": "Save",
  "share.status.saved": "Saved",
  "share.status.error": "Error",
  "share.status.rotatedCopied": "Rotated + copied to clipboard",
  "share.status.rotatedReveal": "Rotated. New password: {password}"
}
```

Add the same keys to `messages/es.json` and `messages/ar.json` with translated values (mirror the existing `locale.*` entries' approach). For `ar.json`, keep the `{password}` placeholder verbatim. **Do not** translate the `{password}` interpolation token. Keep the en `share.status.rotatedReveal` exactly as shown (the rotate test regex depends on it). Verify keys exist in all three files so the i18n audit (`i18n-audit.report.json` / `pnpm` audit script, if wired) stays clean — run whatever i18n-completeness check the repo uses (grep for an `i18n` script in `package.json`).

- [ ] **Step 3: Apply the keyed `t(...)` calls to the remaining static PageMenu labels**

Add `const t = useT();` (if not already added in Task 3) and replace the hard-coded `aria-label="Page menu"`, `Publish to web`, `Unpublish` strings with `t('pageMenu.menu')`, `t('pageMenu.publish')`, `t('pageMenu.unpublish')`. (Leave Export/Import/template/activity labels for a later microcopy pass — out of scope here; only the publish/share surface is in scope.)

- [ ] **Step 4: Write the wiring test**

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageMenu } from '@/components/page-menu';
import { I18nProvider } from '@/lib/i18n/provider';
import en from '../../messages/en.json';

vi.mock('@/components/pwa/offline-context', () => ({ useActionAllowed: () => true }));
afterEach(cleanup);

describe('PageMenu share launcher (#120)', () => {
  it('opens the Share modal from "Manage sharing…" when published', () => {
    render(
      <I18nProvider locale="en" messages={en as Record<string, string>}>
        <PageMenu pageId="p1" initialPublished initialSlug="my-page" />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: en['pageMenu.menu'] }));
    fireEvent.click(screen.getByRole('button', { name: en['share.manage'] }));
    expect(screen.getByRole('dialog', { name: en['share.title'] })).toBeTruthy();
  });
});
```

- [ ] **Step 5: Verify the whole surface**

Run: `source ~/.zshenv && pnpm vitest run tests/components/page-menu-share.test.tsx tests/components/page-menu-publish-confirm.test.tsx tests/components/pages/share-dialog.test.tsx tests/components/pages/share-panel-rotate.test.tsx tests/components/ui/password-input.test.tsx && pnpm lint && pnpm typecheck && pnpm build`
Expected: all green; lint/types/build clean. (`pnpm build` because this touches client components + i18n message files.)

- [ ] **Step 6: Commit**

```bash
git add src/components/page-menu.tsx messages/en.json messages/es.json messages/ar.json tests/components/page-menu-share.test.tsx
git commit -m "feat(share): launch Share modal from page menu + i18n share/publish strings — Closes #120"
```

---

## WCAG AA + touch-target gate

- The Share modal and publish-confirm modal are **real focus-trap dialogs** (radix `Dialog`): Esc dismiss, outside-click dismiss, focus trap, focus restoration to the trigger — satisfies the keyboard-accessibility constraint for #118.
- Every new interactive control clears ≥44px: `PasswordInput` (`min-h-11`, toggle `min-h-11 min-w-11`), dialog close button (`min-h-11 min-w-11`), `DateField` (themed primitive), and the shadcn `Button`s.
- The password toggle is a real `<button>` with `aria-pressed`, a name that flips (`Show password` ↔ `Hide password`), and `aria-hidden` glyphs.
- All visible labels are associated controls (`<Label htmlFor>` / `aria-label`); the save-status line is `aria-live="polite"`.
- All new strings are i18n'd across en/es/ar; the `{password}` interpolation token is preserved untranslated.

## Self-Review

- Spec coverage: #120 (Share modal, roomy labelled form) ✓, #118 (publish confirm; unpublish stays immediate) ✓, #119 (password show/hide eye toggle) ✓.
- Dependency on `ui/dialog.tsx` (plan `-21-`) noted, with a self-contained Task 0 fallback if it hasn't landed. ✓
- Existing behaviour preserved: per-change PATCH, rotate flow + clipboard fallback, status text (`Rotated. New password:` regex still matches via the en value). ✓
- New primitive (`PasswordInput`) is reusable beyond this surface. ✓
- Modal-vs-subtab decision recorded (modal; no settings-tab surface exists, modal reuses the focus-trap primitive). ✓
- No placeholders except where the plan explicitly says "read the file first / use the real names in-file." ✓
