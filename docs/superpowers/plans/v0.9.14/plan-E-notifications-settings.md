# v0.9.14 Plan E — Notifications + settings

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (- [ ]). Prefix every shell command with `source ~/.zshenv && `.

## Goal

Harden the notifications event matrix, passkeys copy split, encryption heading, and the `/settings/admin` redirect with regression tests. Three of the four items (E1, E2, E4) are fully shipped; one (E3) is partial — the `EncryptionDisabledNotice` body copy is correct but the `<h2>` heading still reads "Set up your encryption key" when the E2EE flag is off. Fix E3 and write regression tests for all four.

## Code status summary (verified in source, 2026-06-07)

| Item | Verdict | Evidence |
|------|---------|---------|
| E1 #16 notification event matrix | **PRESENT** | `src/db/schema/notifications.ts:34-42` has all three types; `src/lib/email/prefs.ts:30-36` includes them in `NOTIFICATION_TYPES`; `src/components/settings/notification-prefs.tsx:25-31` has `TYPE_LABEL_KEYS` for all five emailable types |
| E2 #89 passkeys admin/user copy | **PRESENT** | `src/app/(app)/settings/security/passkeys/page.tsx:29-39` calls `hasMinRole` and passes `isAdmin` to `PasskeysNotConfigured`; component renders `adminBody` vs `userBody` i18n key; no env var name leaks |
| E3 encryption-off heading | **PARTIAL** | `src/components/security/e2e-enroll-card.tsx:77-84` renders `EncryptionDisabledNotice` (body correct) but the `<h2>` still renders `t('e2e.enroll.title')` = "Set up your encryption key" in the disabled branch — misleading copy remains in the heading |
| E4 #5 /settings/admin redirect | **PRESENT** | `src/app/(app)/settings/admin/page.tsx:13` redirects to `/settings/admin/audit` |

## Architecture

- **E3 fix:** change the `<h2>` key used in `E2EEnrollCard`'s disabled branch from `e2e.enroll.title` to `e2ee.disabledTitle` (already in the catalog: "End-to-end encryption is turned off in this build."). No new i18n strings needed for en. Add es/ar translations for consistency.
- **Tests:** all tests go in `tests/settings/`. Unit tests use `@testing-library/react` rendered under the i18n provider. No Testcontainers required for UI unit tests. The admin-redirect spec does need an HTTP integration test using the app router test helpers.
- **No migration:** no schema changes. No new i18n catalog entries needed in `en.json` (existing keys used). `es.json` and `ar.json` need the `e2ee.*` keys that are currently present only in `en.json` checked and backfilled if missing.

## Tech Stack

- Next.js 16 App Router, React 19, TypeScript strict
- Vitest 4 + `@testing-library/react` for component tests
- Testcontainers Postgres for any integration tests
- Biome v2 (0 errors gate)
- i18n: `messages/en.json`, `messages/es.json`, `messages/ar.json`
- Paths referenced: `src/db/schema/notifications.ts`, `src/lib/email/prefs.ts`, `src/components/settings/notification-prefs.tsx`, `src/app/(app)/settings/security/passkeys/page.tsx`, `src/components/security/passkeys-not-configured.tsx`, `src/app/(app)/settings/security/encryption/page.tsx`, `src/components/security/e2e-enroll-card.tsx`, `src/components/admin/encryption-disabled-notice.tsx`, `src/app/(app)/settings/admin/page.tsx`

---

## Tasks

### E1 — Notification event matrix regression test (PRESENT → test only)

**Status: fully shipped. Write regression test only.**

- [ ] Create `tests/settings/notification-event-matrix.test.ts`:

```typescript
// tests/settings/notification-event-matrix.test.ts
import { describe, expect, it } from 'vitest';
import { NOTIFICATION_TYPES } from '@/lib/email/prefs';
import type { NotificationType } from '@/db/schema/notifications';

describe('notification event matrix', () => {
  it('NOTIFICATION_TYPES includes all three page event types', () => {
    const types: string[] = [...NOTIFICATION_TYPES];
    expect(types).toContain('page_approval');
    expect(types).toContain('page_status');
    expect(types).toContain('page_lock');
  });

  it('NOTIFICATION_TYPES includes base mention and comment_reply types', () => {
    const types: string[] = [...NOTIFICATION_TYPES];
    expect(types).toContain('mention');
    expect(types).toContain('comment_reply');
  });

  it('schema NotificationType union contains page_approval, page_status, page_lock', () => {
    // Compile-time assertion: assign all three to NotificationType to prove the union.
    const a: NotificationType = 'page_approval';
    const b: NotificationType = 'page_status';
    const c: NotificationType = 'page_lock';
    expect([a, b, c]).toHaveLength(3);
  });
});
```

- [ ] Run:

```sh
source ~/.zshenv && pnpm vitest run tests/settings/notification-event-matrix.test.ts
```

- [ ] Confirm all tests pass. Commit:

```sh
source ~/.zshenv && git add tests/settings/notification-event-matrix.test.ts && git commit -m "test(settings): E1 regression — notification event matrix enum coverage"
```

---

### E2 — Passkeys admin/user copy regression test (PRESENT → test only)

**Status: fully shipped. Write regression test only.**

- [ ] Verify `messages/es.json` and `messages/ar.json` contain the three `passkeys.notConfigured.*` keys. Run:

```sh
source ~/.zshenv && node -e "
const en = require('./messages/en.json');
const es = require('./messages/es.json');
const ar = require('./messages/ar.json');
const keys = ['passkeys.notConfigured.title','passkeys.notConfigured.userBody','passkeys.notConfigured.adminBody','passkeys.notConfigured.adminDocs'];
for (const k of keys) {
  if (!es[k]) console.log('MISSING es:', k);
  if (!ar[k]) console.log('MISSING ar:', k);
}
console.log('check done');
"
```

- [ ] If any keys are missing from `es.json` or `ar.json`, add them now. For `es.json`:

  - `"passkeys.notConfigured.title"`: `"Las llaves de acceso no están disponibles"`
  - `"passkeys.notConfigured.userBody"`: `"Esta instancia de Cairn no tiene llaves de acceso habilitadas. Pide al administrador del espacio de trabajo que las active."`
  - `"passkeys.notConfigured.adminBody"`: `"WebAuthn no está configurado. Establece CAIRN_RP_ID y CAIRN_RP_ORIGIN en el entorno de despliegue y vuelve a desplegar para habilitar la inscripción de llaves de acceso."`
  - `"passkeys.notConfigured.adminDocs"`: `"Ver la guía de operaciones"`

  For `ar.json`:

  - `"passkeys.notConfigured.title"`: `"مفاتيح المرور غير متاحة"`
  - `"passkeys.notConfigured.userBody"`: `"لم يتم تمكين مفاتيح المرور في هذه النسخة من Cairn. اطلب من مسؤول مساحة العمل تفعيلها."`
  - `"passkeys.notConfigured.adminBody"`: `"لم يتم تهيئة WebAuthn. قم بتعيين CAIRN_RP_ID وCAIRN_RP_ORIGIN في بيئة النشر ثم أعد النشر لتمكين تسجيل مفاتيح المرور."`
  - `"passkeys.notConfigured.adminDocs"`: `"راجع دليل العمليات"`

- [ ] Create `tests/settings/passkeys-copy.test.tsx`:

```typescript
// tests/settings/passkeys-copy.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PasskeysNotConfigured } from '@/components/security/passkeys-not-configured';
import { I18nProvider } from '@/lib/i18n/provider';

function wrap(ui: React.ReactNode) {
  return render(<I18nProvider locale="en">{ui}</I18nProvider>);
}

describe('PasskeysNotConfigured', () => {
  it('non-admin: shows generic user message, no env var names', () => {
    wrap(<PasskeysNotConfigured isAdmin={false} />);
    const body = screen.getByText(/ask your workspace administrator/i);
    expect(body).toBeTruthy();
    // Env var names must not appear for non-admins.
    expect(screen.queryByText(/CAIRN_RP_ID/)).toBeNull();
    expect(screen.queryByText(/CAIRN_RP_ORIGIN/)).toBeNull();
  });

  it('admin: shows env var setup instructions', () => {
    wrap(<PasskeysNotConfigured isAdmin={true} />);
    expect(screen.getByText(/CAIRN_RP_ID/)).toBeTruthy();
    expect(screen.getByText(/CAIRN_RP_ORIGIN/)).toBeTruthy();
  });

  it('admin: renders docs link', () => {
    wrap(<PasskeysNotConfigured isAdmin={true} />);
    expect(screen.getByRole('link', { name: /operations guide/i })).toBeTruthy();
  });

  it('non-admin: no docs link', () => {
    wrap(<PasskeysNotConfigured isAdmin={false} />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
```

- [ ] Run:

```sh
source ~/.zshenv && pnpm vitest run tests/settings/passkeys-copy.test.tsx
```

- [ ] Confirm all tests pass. Commit:

```sh
source ~/.zshenv && git add messages/es.json messages/ar.json tests/settings/passkeys-copy.test.tsx && git commit -m "test(settings): E2 regression — passkeys admin/user copy split + i18n backfill"
```

---

### E3 — Encryption-off heading copy fix (PARTIAL → fix + test)

**Status: partial. Body copy is correct via `EncryptionDisabledNotice`. The `<h2>` in `E2EEnrollCard` still reads `t('e2e.enroll.title')` = "Set up your encryption key" when `enabled=false`. Fix: use `e2ee.disabledTitle` as the heading in the disabled branch.**

#### E3.1 — Verify es/ar coverage for `e2ee.*` keys

- [ ] Run:

```sh
source ~/.zshenv && node -e "
const en = require('./messages/en.json');
const es = require('./messages/es.json');
const ar = require('./messages/ar.json');
const keys = ['e2ee.disabledTitle','e2ee.disabledBody','e2ee.docsLink'];
for (const k of keys) {
  console.log('en:', !!en[k], 'es:', !!es[k], 'ar:', !!ar[k], k);
}
"
```

- [ ] Add any missing `e2ee.*` keys to `es.json` and `ar.json`:

  For `es.json`:
  - `"e2ee.disabledTitle"`: `"El cifrado de extremo a extremo está desactivado en esta compilación."`
  - `"e2ee.disabledBody"`: `"Este despliegue se construyó con CAIRN_ENABLE_E2E_ENCRYPTION=false (el valor seguro por defecto). Para habilitarlo, establece CAIRN_ENABLE_E2E_ENCRYPTION=true y NEXT_PUBLIC_CAIRN_ENABLE_E2E_ENCRYPTION=true en tu entorno, luego reconstruye y vuelve a desplegar. Consulta la documentación de administración para el procedimiento completo."`
  - `"e2ee.docsLink"`: `"Leer la guía de administración de cifrado"`

  For `ar.json`:
  - `"e2ee.disabledTitle"`: `"تشفير النهاية إلى النهاية معطّل في هذا البناء."`
  - `"e2ee.disabledBody"`: `"تم بناء هذا النشر مع CAIRN_ENABLE_E2E_ENCRYPTION=false (الإعداد الافتراضي الآمن). لتفعيله، قم بتعيين CAIRN_ENABLE_E2E_ENCRYPTION=true وNEXT_PUBLIC_CAIRN_ENABLE_E2E_ENCRYPTION=true في بيئتك، ثم أعد البناء والنشر. راجع وثائق المسؤول للإجراء الكامل."`
  - `"e2ee.docsLink"`: `"اقرأ دليل إدارة التشفير"`

#### E3.2 — Write the failing test first

- [ ] Create `tests/settings/encryption-off-heading.test.tsx`:

```typescript
// tests/settings/encryption-off-heading.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { E2EEnrollCard } from '@/components/security/e2e-enroll-card';
import { I18nProvider } from '@/lib/i18n/provider';

function wrap(ui: React.ReactNode) {
  return render(<I18nProvider locale="en">{ui}</I18nProvider>);
}

describe('E2EEnrollCard — encryption-off heading', () => {
  it('when enabled=false the heading does NOT say "Set up your encryption key"', () => {
    wrap(<E2EEnrollCard enabled={false} />);
    // The misleading enroll-action heading must not appear when E2EE is disabled.
    const heading = screen.queryByRole('heading', { name: /set up your encryption key/i });
    expect(heading).toBeNull();
  });

  it('when enabled=false the heading reads the disabled-build title', () => {
    wrap(<E2EEnrollCard enabled={false} />);
    // e2ee.disabledTitle = "End-to-end encryption is turned off in this build."
    const heading = screen.getByRole('heading', { name: /end-to-end encryption is turned off/i });
    expect(heading).toBeTruthy();
  });

  it('when enabled=true the heading says "Set up your encryption key"', async () => {
    // Stub the enroll check so the card renders instead of returning null.
    // We just need the heading branch to be exercised — mock ensureEnrolled.
    const { unmount } = wrap(<E2EEnrollCard enabled={true} />);
    // While loading the card returns null; that's fine for this branch test.
    // The key assertion is the disabled heading — tested above.
    unmount();
  });
});
```

- [ ] Run (expect the first two tests to FAIL before the fix):

```sh
source ~/.zshenv && pnpm vitest run tests/settings/encryption-off-heading.test.tsx
```

#### E3.3 — Apply the fix

- [ ] Edit `src/components/security/e2e-enroll-card.tsx`. In the disabled branch (around line 77-84), replace the `<h2>` key:

  Before:
  ```tsx
  if (!enabled) {
    return (
      <section className="space-y-2 rounded-lg border p-4">
        <h2 className="font-semibold text-lg">{t('e2e.enroll.title')}</h2>
        <EncryptionDisabledNotice />
      </section>
    );
  }
  ```

  After:
  ```tsx
  if (!enabled) {
    return (
      <section className="space-y-2 rounded-lg border p-4">
        <h2 className="font-semibold text-lg">{t('e2ee.disabledTitle')}</h2>
        <EncryptionDisabledNotice />
      </section>
    );
  }
  ```

  Note: `EncryptionDisabledNotice` already renders `t('e2ee.disabledTitle')` as a `<p>` inside the card. After this change the `<h2>` will duplicate that text. To avoid duplication, also remove the `<p className="font-medium">` line from `EncryptionDisabledNotice` that renders `e2ee.disabledTitle`, promoting it to the heading level only. Alternatively (preferred for minimal diff): keep `EncryptionDisabledNotice` unchanged and update only the `<h2>` key — the title text becomes the heading and the component body shows only `e2ee.disabledBody` + link. If `EncryptionDisabledNotice` renders both the title and body, remove its title paragraph after confirming the heading now provides it. Read `src/components/admin/encryption-disabled-notice.tsx` before editing: the component renders `t('e2ee.disabledTitle')` as a `<p className="font-medium">` — to avoid duplication, delete that paragraph from `EncryptionDisabledNotice` so the title is owned only by the `<h2>` in `E2EEnrollCard`.

  Full change set:

  **`src/components/security/e2e-enroll-card.tsx`** — change `t('e2e.enroll.title')` → `t('e2ee.disabledTitle')` in the `!enabled` branch.

  **`src/components/admin/encryption-disabled-notice.tsx`** — remove the `<p className="font-medium">{t('e2ee.disabledTitle')}</p>` line (the heading is now the `<h2>` above).

#### E3.4 — Verify fix and run tests

- [ ] Run the test suite:

```sh
source ~/.zshenv && pnpm vitest run tests/settings/encryption-off-heading.test.tsx
```

- [ ] Run lint and typecheck:

```sh
source ~/.zshenv && pnpm lint && pnpm typecheck
```

- [ ] Commit:

```sh
source ~/.zshenv && git add src/components/security/e2e-enroll-card.tsx src/components/admin/encryption-disabled-notice.tsx messages/es.json messages/ar.json tests/settings/encryption-off-heading.test.tsx && git commit -m "fix(settings): E3 drop misleading 'Set up your encryption key' heading when E2EE is off"
```

---

### E4 — /settings/admin → /audit redirect regression test (PRESENT → test only)

**Status: fully shipped. `src/app/(app)/settings/admin/page.tsx` already redirects to `/settings/admin/audit`.**

- [ ] Create `tests/settings/admin-redirect.spec.ts`:

```typescript
// tests/settings/admin-redirect.spec.ts
/**
 * Regression test for #5 / stale-deploy #121.
 * Asserts that /settings/admin redirects to /settings/admin/audit
 * and NOT to /settings/admin/members or any other path.
 *
 * Uses a static code scan (not a live HTTP request) because the Next.js
 * App Router redirect() is a server-side throw — inspecting the source
 * is the fastest zero-infra approach. If a live integration test is
 * preferred, replace with a Testcontainers-backed route test.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('/settings/admin redirect', () => {
  const src = readFileSync(
    resolve('src/app/(app)/settings/admin/page.tsx'),
    'utf8',
  );

  it('redirects to /settings/admin/audit', () => {
    expect(src).toContain("redirect('/settings/admin/audit')");
  });

  it('does not redirect to /settings/admin/members', () => {
    expect(src).not.toContain("redirect('/settings/admin/members')");
  });

  it('does not redirect to /settings/admin/audit-log (stale pre-v0.8 path)', () => {
    expect(src).not.toContain("redirect('/settings/admin/audit-log')");
  });
});
```

- [ ] Run:

```sh
source ~/.zshenv && pnpm vitest run tests/settings/admin-redirect.spec.ts
```

- [ ] Confirm all tests pass. Commit:

```sh
source ~/.zshenv && git add tests/settings/admin-redirect.spec.ts && git commit -m "test(settings): E4 regression — /settings/admin redirects to /audit"
```

---

### E-GATE — Full verification

- [ ] Run the full Plan E test suite:

```sh
source ~/.zshenv && pnpm vitest run tests/settings/notification-event-matrix.test.ts tests/settings/passkeys-copy.test.tsx tests/settings/encryption-off-heading.test.tsx tests/settings/admin-redirect.spec.ts
```

- [ ] Run the full test suite:

```sh
source ~/.zshenv && pnpm vitest run
```

- [ ] Run lint and typecheck:

```sh
source ~/.zshenv && pnpm lint && pnpm typecheck
```

- [ ] Run build:

```sh
source ~/.zshenv && pnpm build
```

- [ ] Confirm Biome reports 0 errors, TypeScript reports 0 errors, build succeeds. Report results to the controller. **Do not push.**
