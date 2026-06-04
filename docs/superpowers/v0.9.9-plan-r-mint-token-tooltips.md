# v0.9.9 — Plan R: Mint Token Tooltips

For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Add a per-scope explanatory hover tooltip to each of the 16 scope checkboxes in the token-mint modal (`MintTokenDialog`), so a user can learn what e.g. `pages:destructive` grants without reading external docs. Tooltips are fully translated (en/es/ar) via `useT()`. Closes #106 / #277.

**Architecture:** `src/components/dev-settings/mint-token-dialog.tsx` is a client component (`'use client'`) rendered from `src/app/(app)/settings/developer/tokens/page.tsx`. It currently renders the 16 scope rows from a module-level `ALL_SCOPES` tuple as plain `<label>` + `<input type="checkbox">` with the raw scope id as the visible text (line 203–212) and uses **no** `useT()`. The repo has **no** `Tooltip` UI primitive and **no** `@radix-ui/react-tooltip` dependency; the established, audit-passing tooltip pattern in this codebase is a native HTML `title=` attribute fed through `t()` — exactly as `src/components/databases/view-switcher.tsx:198` does for disabled view types (`title={t(\`database.view.disabled.${type}\`)}`). We follow that pattern: attach `title={t(\`devTokens.scope.${scope}.tip\`)}` to each scope row and keep the existing visible scope id text. This keeps the change dependency-free, accessible (native tooltip + the label text still names the scope), and consistent with the rest of the app. The scope id strings themselves (`pages:read`, …) are stable machine identifiers, **not** translatable copy — only the explanatory tip and an optional human-readable scope label are translated.

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript 6 (strict) · Biome v2 (0-error gate) · Vitest 4 + `@testing-library/react` · i18n via `useT()` from `src/lib/i18n/provider.tsx` with flat key-value catalogs in `messages/{en,es,ar}.json` (audited by `scripts/i18n-audit.ts` against `i18n-audit.baseline.json`).

---

## R1 — Per-scope hover tooltips in the mint-token modal (#106 / #277)

The 16 scopes in `ALL_SCOPES` are: `pages:read`, `pages:write`, `pages:destructive`, `databases:read`, `databases:write`, `databases:destructive`, `comments:read`, `comments:write`, `comments:destructive`, `files:read`, `files:write`, `files:destructive`, `mcp:read`, `mcp:write`, `mcp:destructive`, `admin`. Each gets a `devTokens.scope.<id>.tip` key.

**Files:**
- **Modify:** `src/components/dev-settings/mint-token-dialog.tsx` — import + call `useT()`; add `title` to each scope row from a tip key.
- **Modify:** `messages/en.json` — add 16 `devTokens.scope.*.tip` keys.
- **Modify:** `messages/es.json` — add the same 16 keys (es).
- **Modify:** `messages/ar.json` — add the same 16 keys (ar).
- **Modify:** `i18n-audit.baseline.json` — regenerate via `pnpm i18n:baseline` so the gate stays at "none new" (the dialog previously had hardcoded English literals that the new `t()` calls now remove or replace; baseline must reflect the new state).
- **Create:** `src/components/dev-settings/mint-token-dialog.test.tsx` — failing-first RTL test asserting each scope checkbox row carries the translated `title`.

### Step 1 — Failing test: every scope row has a translated tooltip title

- [ ] Write `src/components/dev-settings/mint-token-dialog.test.tsx`. It renders the dialog wrapped in `I18nProvider` (en) and asserts that, after expanding the `<details>` "Custom scopes" disclosure, each scope row exposes its label and a non-empty `title` matching the catalog tip. Use the real en catalog so the test breaks if a key is missing.

```tsx
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import enMessages from '../../../messages/en.json' with { type: 'json' };
import { I18nProvider } from '@/lib/i18n/provider';
import type { Messages } from '@/lib/i18n/t';
import { MintTokenDialog } from './mint-token-dialog';

const SCOPES = [
  'pages:read',
  'pages:write',
  'pages:destructive',
  'databases:read',
  'databases:write',
  'databases:destructive',
  'comments:read',
  'comments:write',
  'comments:destructive',
  'files:read',
  'files:write',
  'files:destructive',
  'mcp:read',
  'mcp:write',
  'mcp:destructive',
  'admin',
] as const;

function renderDialog() {
  return render(
    <I18nProvider locale="en" messages={enMessages as Messages}>
      <MintTokenDialog onClose={vi.fn()} onMinted={vi.fn()} />
    </I18nProvider>,
  );
}

describe('MintTokenDialog scope tooltips (#106/#277)', () => {
  it('renders a translated title tooltip on every scope checkbox row', () => {
    renderDialog();
    // "Custom scopes" disclosure: jsdom renders <details> children regardless
    // of open state, so the checkboxes are queryable without a click.
    for (const scope of SCOPES) {
      const checkbox = screen.getByRole('checkbox', { name: scope });
      const row = checkbox.closest('label');
      expect(row, `row for ${scope}`).not.toBeNull();
      const expected = (enMessages as Record<string, string>)[`devTokens.scope.${scope}.tip`];
      expect(expected, `en tip key for ${scope}`).toBeTruthy();
      expect(row).toHaveAttribute('title', expected);
    }
  });

  it('labels each row with the literal scope id (machine identifier, untranslated)', () => {
    renderDialog();
    for (const scope of SCOPES) {
      expect(screen.getByRole('checkbox', { name: scope })).toBeInTheDocument();
      expect(screen.getByText(scope)).toBeInTheDocument();
    }
  });
});
```

- [ ] **Run-to-fail:** `source ~/.zshenv && pnpm vitest run src/components/dev-settings/mint-token-dialog.test.tsx`. Expect failure: the `title` assertion fails because the rows currently have no `title` attribute (and the en keys don't exist yet → `expected` is `undefined`).

### Step 2 — Add the en tooltip keys

- [ ] Add these 16 keys to `messages/en.json` (place them with the other `devTokens.*` keys; Biome/JSON ordering is not enforced for catalogs, but keep them grouped):

```json
{
  "devTokens.scope.pages:read.tip": "pages:read — Read pages and their content (titles, body, blocks). No changes.",
  "devTokens.scope.pages:write.tip": "pages:write — Create and edit pages and their content. Cannot delete.",
  "devTokens.scope.pages:destructive.tip": "pages:destructive — Delete pages and their children (irreversible).",
  "devTokens.scope.databases:read.tip": "databases:read — Read databases, views, properties, and rows. No changes.",
  "devTokens.scope.databases:write.tip": "databases:write — Create and edit databases, properties, views, and rows. Cannot delete.",
  "devTokens.scope.databases:destructive.tip": "databases:destructive — Delete databases, properties, and rows (irreversible).",
  "devTokens.scope.comments:read.tip": "comments:read — Read comments and discussion threads. No changes.",
  "devTokens.scope.comments:write.tip": "comments:write — Post and edit comments and replies. Cannot delete.",
  "devTokens.scope.comments:destructive.tip": "comments:destructive — Delete comments and resolve threads (irreversible).",
  "devTokens.scope.files:read.tip": "files:read — Download files and read attachment metadata. No changes.",
  "devTokens.scope.files:write.tip": "files:write — Upload files and attach them to pages. Cannot delete.",
  "devTokens.scope.files:destructive.tip": "files:destructive — Permanently delete uploaded files (irreversible).",
  "devTokens.scope.mcp:read.tip": "mcp:read — Let MCP clients call read-only tools (search, fetch). No changes.",
  "devTokens.scope.mcp:write.tip": "mcp:write — Let MCP clients call tools that create or edit content. Cannot delete.",
  "devTokens.scope.mcp:destructive.tip": "mcp:destructive — Let MCP clients call destructive tools that delete content (irreversible).",
  "devTokens.scope.admin.tip": "admin — Full workspace administration: members, settings, billing, and all data. Grant with extreme care."
}
```

### Step 3 — Add the es tooltip keys

- [ ] Add the matching 16 keys to `messages/es.json`:

```json
{
  "devTokens.scope.pages:read.tip": "pages:read — Leer páginas y su contenido (títulos, cuerpo, bloques). Sin cambios.",
  "devTokens.scope.pages:write.tip": "pages:write — Crear y editar páginas y su contenido. No puede eliminar.",
  "devTokens.scope.pages:destructive.tip": "pages:destructive — Eliminar páginas y sus subpáginas (irreversible).",
  "devTokens.scope.databases:read.tip": "databases:read — Leer bases de datos, vistas, propiedades y filas. Sin cambios.",
  "devTokens.scope.databases:write.tip": "databases:write — Crear y editar bases de datos, propiedades, vistas y filas. No puede eliminar.",
  "devTokens.scope.databases:destructive.tip": "databases:destructive — Eliminar bases de datos, propiedades y filas (irreversible).",
  "devTokens.scope.comments:read.tip": "comments:read — Leer comentarios e hilos de discusión. Sin cambios.",
  "devTokens.scope.comments:write.tip": "comments:write — Publicar y editar comentarios y respuestas. No puede eliminar.",
  "devTokens.scope.comments:destructive.tip": "comments:destructive — Eliminar comentarios y resolver hilos (irreversible).",
  "devTokens.scope.files:read.tip": "files:read — Descargar archivos y leer metadatos de adjuntos. Sin cambios.",
  "devTokens.scope.files:write.tip": "files:write — Subir archivos y adjuntarlos a páginas. No puede eliminar.",
  "devTokens.scope.files:destructive.tip": "files:destructive — Eliminar permanentemente archivos subidos (irreversible).",
  "devTokens.scope.mcp:read.tip": "mcp:read — Permitir que clientes MCP usen herramientas de solo lectura (buscar, obtener). Sin cambios.",
  "devTokens.scope.mcp:write.tip": "mcp:write — Permitir que clientes MCP usen herramientas que crean o editan contenido. No puede eliminar.",
  "devTokens.scope.mcp:destructive.tip": "mcp:destructive — Permitir que clientes MCP usen herramientas destructivas que eliminan contenido (irreversible).",
  "devTokens.scope.admin.tip": "admin — Administración completa del espacio de trabajo: miembros, ajustes, facturación y todos los datos. Conceder con extremo cuidado."
}
```

### Step 4 — Add the ar tooltip keys

- [ ] Add the matching 16 keys to `messages/ar.json`. The scope id prefix stays LTR; the descriptive clause is Arabic. (RTL rendering is handled by the existing `dir` on the document root from the locale resolver — no per-string markup needed.)

```json
{
  "devTokens.scope.pages:read.tip": "pages:read — قراءة الصفحات ومحتواها (العناوين والنص والكتل). دون أي تغييرات.",
  "devTokens.scope.pages:write.tip": "pages:write — إنشاء الصفحات ومحتواها وتعديلها. لا يمكن الحذف.",
  "devTokens.scope.pages:destructive.tip": "pages:destructive — حذف الصفحات وصفحاتها الفرعية (لا يمكن التراجع).",
  "devTokens.scope.databases:read.tip": "databases:read — قراءة قواعد البيانات والعروض والخصائص والصفوف. دون أي تغييرات.",
  "devTokens.scope.databases:write.tip": "databases:write — إنشاء قواعد البيانات والخصائص والعروض والصفوف وتعديلها. لا يمكن الحذف.",
  "devTokens.scope.databases:destructive.tip": "databases:destructive — حذف قواعد البيانات والخصائص والصفوف (لا يمكن التراجع).",
  "devTokens.scope.comments:read.tip": "comments:read — قراءة التعليقات وسلاسل النقاش. دون أي تغييرات.",
  "devTokens.scope.comments:write.tip": "comments:write — نشر التعليقات والردود وتعديلها. لا يمكن الحذف.",
  "devTokens.scope.comments:destructive.tip": "comments:destructive — حذف التعليقات وإغلاق السلاسل (لا يمكن التراجع).",
  "devTokens.scope.files:read.tip": "files:read — تنزيل الملفات وقراءة بيانات المرفقات. دون أي تغييرات.",
  "devTokens.scope.files:write.tip": "files:write — رفع الملفات وإرفاقها بالصفحات. لا يمكن الحذف.",
  "devTokens.scope.files:destructive.tip": "files:destructive — حذف الملفات المرفوعة نهائيًا (لا يمكن التراجع).",
  "devTokens.scope.mcp:read.tip": "mcp:read — السماح لعملاء MCP باستخدام أدوات القراءة فقط (بحث، جلب). دون أي تغييرات.",
  "devTokens.scope.mcp:write.tip": "mcp:write — السماح لعملاء MCP باستخدام أدوات تنشئ المحتوى أو تعدله. لا يمكن الحذف.",
  "devTokens.scope.mcp:destructive.tip": "mcp:destructive — السماح لعملاء MCP باستخدام أدوات مدمرة تحذف المحتوى (لا يمكن التراجع).",
  "devTokens.scope.admin.tip": "admin — إدارة كاملة لمساحة العمل: الأعضاء والإعدادات والفوترة وجميع البيانات. امنحه بحذر شديد."
}
```

### Step 5 — Minimal impl: wire `useT()` + `title` into the scope rows

- [ ] In `src/components/dev-settings/mint-token-dialog.tsx`, add the import alongside the other imports near the top:

```tsx
import { useT } from '@/lib/i18n/provider';
```

- [ ] Inside `MintTokenDialog`, after the `useFocusTrap` line (around line 103), add:

```tsx
  const t = useT();
```

- [ ] Replace the scope-row `<label>` block (currently lines 203–212) with the `title`-bearing version. The visible text stays the literal scope id `{s}` (machine identifier — intentionally untranslated); only the `title` is translated:

```tsx
            {ALL_SCOPES.map((s) => (
              <label key={s} className="flex items-center gap-1" title={t(`devTokens.scope.${s}.tip`)}>
                <input
                  type="checkbox"
                  checked={scopes.includes(s)}
                  onChange={() => toggleScope(s)}
                />
                {s}
              </label>
            ))}
```

- [ ] **Run-to-pass:** `source ~/.zshenv && pnpm vitest run src/components/dev-settings/mint-token-dialog.test.tsx`. Both cases pass.

### Step 6 — Refresh the i18n audit baseline (keep gate at "none new")

- [ ] The dialog still contains other hardcoded English literals unrelated to this issue (e.g. the `<h2>`, `Name`, `Preset` labels). This plan deliberately does **not** translate those (out of scope for #106/#277) — but the `t()` call addition and any incidental literal removals can shift the audit findings. Regenerate the baseline so the CI gate reports **zero new** untranslated strings:

```sh
source ~/.zshenv && pnpm i18n:baseline
```

- [ ] **Verify none-new:** `source ~/.zshenv && pnpm i18n:check` exits 0 (no findings beyond the regenerated baseline). Confirm the diff to `i18n-audit.baseline.json` only removes/keeps entries and adds none that represent newly-introduced untranslated copy.

### Step 7 — Commit

- [ ] `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm vitest run src/components/dev-settings/mint-token-dialog.test.tsx` all green, then commit:

```sh
git add src/components/dev-settings/mint-token-dialog.tsx \
  src/components/dev-settings/mint-token-dialog.test.tsx \
  messages/en.json messages/es.json messages/ar.json i18n-audit.baseline.json
git commit -m "feat(dev-tokens): per-scope hover tooltips in mint-token modal

Each of the 16 scope checkboxes in MintTokenDialog now carries a
translated title tooltip explaining what the scope grants (e.g.
'pages:destructive — Delete pages and their children (irreversible)').
Uses the native title= pattern (matching view-switcher) — no new deps.
i18n en/es/ar.

Closes #106
Closes #277

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## R-GATE — Plan R group gate (HOLD for GO before merge)

Single PR onto `patches/v0.9.9`. GitHub-hosted runners only. Zero-deferral. Run the full sequence and paste real output into the PR:

- [ ] `source ~/.zshenv && pnpm lint` — Biome reports **0 errors**.
- [ ] `source ~/.zshenv && pnpm typecheck` — `tsc --noEmit` clean.
- [ ] `source ~/.zshenv && pnpm i18n:check` — **none new** vs the regenerated `i18n-audit.baseline.json`; confirm all 16 `devTokens.scope.*.tip` keys exist in **all three** of `messages/{en,es,ar}.json` (no missing-locale findings).
- [ ] `source ~/.zshenv && pnpm vitest run` — **full** suite green (not just the new file; Testcontainers/Docker must be up via Colima).
- [ ] `source ~/.zshenv && pnpm build` — `next build` + entrypoint tsc succeed.
- [ ] **e2e UI-acceptance gate (route-reachability + per-feature deployed-image check):**
  - Route smoke: `/settings/developer/tokens` returns 200 for an authenticated owner (Playwright route-reachability check against the deployed image).
  - Per-feature deployed-image check: open the page, click **Mint new token**, expand **Custom scopes**, hover each of the 16 scope rows, and confirm the native tooltip text renders and matches the active locale (spot-check en + ar to prove RTL display). Confirm the visible row text is still the literal scope id and the checkbox toggles state.
- [ ] **HOLD for user GO** before merging the single `patches/v0.9.9` PR.
