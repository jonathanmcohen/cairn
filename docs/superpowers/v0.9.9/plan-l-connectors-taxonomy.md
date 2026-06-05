# v0.9.9 Plan L — Connectors Taxonomy

For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** Fix the two connectors-page taxonomy findings from the v0.9.8 live audit. The `/settings/developer/connectors` route renders **two** sections that both read as "connectors" (issue #196 / live-audit #17): a database-sync section (`CreateConnectorFlow` + `DatabaseConnectorsList`) headed "Database connectors", and a chat-bridge section (`ConnectorsPanel`) headed "Connectors". Rename them to unambiguous, non-colliding headings — "Database sync" and "Chat bridge" — via i18n (en/es/ar). Then unify the create-button verb per section (#197 / live-audit #196 — note the audit reused the issue number as its own item id): the DB section's primary button says "New connector" while the chat section says "Add connector"; both must use the same verb ("New") and name their own thing.

This is a copy/i18n-only change. No schema, no migration, no route move (the chat-bridge *relocation* #186 is owned by Plan G3 — Plan L only renames the on-page headings and buttons; do not move routes here).

**Architecture:** Cairn's i18n is a flat dotted-key catalogue in `messages/{en,es,ar}.json`, resolved through `useT()` from `src/lib/i18n/provider`. Both section components are client components under `src/app/(app)/settings/developer/connectors/`. The page server component (`page.tsx`) composes `CreateConnectorFlow` + `DatabaseConnectorsList` (DB-sync section) above `ConnectorsPanel` (chat-bridge section). All four user-facing strings touched here already exist as keys; this plan changes **values only** (no new keys, so the i18n-none-new gate stays green) plus one Vitest assertion guarding the rename so the heading collision cannot silently regress.

Existing relevant keys (values being changed):
- `connectorsDb.heading` = "Database connectors" → "Database sync"
- `connectorsDb.create` = "New connector" → "New database sync"
- `connectors.title` = "Connectors" → "Chat bridge"
- `connectors.add` = "Add connector" → "New chat bridge"

Verb decision (locked): both section create buttons use the imperative **"New"** + the section's own object name. Rationale: "New" is the dominant create verb already in this catalogue (`connectorsDb.create` = "New connector", `connectorsDb.config.heading`, `connectorsDb.create.submit`), so unifying on "New" is the smaller, more consistent edit than flipping everything to "Add".

**Tech Stack:** Next.js 16 App Router (React 19, TS6), Biome v2 (0 errors), Vitest 4 + Testcontainers, i18n en/es/ar via `useT()`. Shell: prefix every command with `source ~/.zshenv && `.

---

## L1 — Rename the two colliding connector section headings (#196 / live-audit #17)

Rename so the page no longer has two "connectors" sections: DB-sync section heading → "Database sync", chat-bridge section heading → "Chat bridge". Both heading strings already flow through `useT()` (`connectorsDb.heading` on `database-connectors-list.tsx:54`; `connectors.title` on `connectors-panel.tsx:32`), so this is a pure value edit in the three locale files, guarded by a unit test that asserts the two headings are now distinct and non-overlapping.

**Files:**
- Modify: `messages/en.json`
- Modify: `messages/es.json`
- Modify: `messages/ar.json`
- Create: `src/app/(app)/settings/developer/connectors/connectors-taxonomy.test.ts`
- (No component edits — `database-connectors-list.tsx:54` and `connectors-panel.tsx:32` already render `t('connectorsDb.heading')` / `t('connectors.title')`.)

Steps:

- [ ] Write a failing test asserting the renamed, distinct headings in all three locales. Create `src/app/(app)/settings/developer/connectors/connectors-taxonomy.test.ts`:
  ```ts
  import en from '../../../../../../messages/en.json';
  import es from '../../../../../../messages/es.json';
  import ar from '../../../../../../messages/ar.json';
  import { describe, expect, it } from 'vitest';

  type Catalogue = Record<string, string>;
  const catalogues: Record<string, Catalogue> = {
    en: en as Catalogue,
    es: es as Catalogue,
    ar: ar as Catalogue,
  };

  describe('connectors page taxonomy (#196 / #17)', () => {
    it('renames the DB-sync heading away from the word "connectors"', () => {
      expect((en as Catalogue)['connectorsDb.heading']).toBe('Database sync');
      expect((es as Catalogue)['connectorsDb.heading']).toBe('Sincronización de bases de datos');
      expect((ar as Catalogue)['connectorsDb.heading']).toBe('مزامنة قاعدة البيانات');
    });

    it('renames the chat-bridge heading from the generic "Connectors"', () => {
      expect((en as Catalogue)['connectors.title']).toBe('Chat bridge');
      expect((es as Catalogue)['connectors.title']).toBe('Puente de chat');
      expect((ar as Catalogue)['connectors.title']).toBe('جسر الدردشة');
    });

    it('gives the two on-page section headings distinct values in every locale', () => {
      for (const [locale, cat] of Object.entries(catalogues)) {
        expect(cat['connectorsDb.heading'], `${locale} DB heading present`).toBeTruthy();
        expect(cat['connectors.title'], `${locale} chat heading present`).toBeTruthy();
        expect(
          cat['connectorsDb.heading'],
          `${locale} headings must differ so the page has no duplicate "connectors" section`,
        ).not.toBe(cat['connectors.title']);
      }
    });
  });
  ```
- [ ] Run it red. `source ~/.zshenv && pnpm vitest run src/app/\(app\)/settings/developer/connectors/connectors-taxonomy.test.ts` — expect failures: `connectorsDb.heading` is still "Database connectors", `connectors.title` is still "Connectors".
- [ ] Apply the en rename. In `messages/en.json` change the two values (keys unchanged):
  - `"connectorsDb.heading": "Database connectors"` → `"connectorsDb.heading": "Database sync"`
  - `"connectors.title": "Connectors"` → `"connectors.title": "Chat bridge"`
- [ ] Apply the es rename. In `messages/es.json`:
  - `"connectorsDb.heading": "Conectores de base de datos"` → `"connectorsDb.heading": "Sincronización de bases de datos"`
  - `"connectors.title": "Conectores"` → `"connectors.title": "Puente de chat"`
- [ ] Apply the ar rename. In `messages/ar.json`:
  - `"connectorsDb.heading": "موصّلات قاعدة البيانات"` → `"connectorsDb.heading": "مزامنة قاعدة البيانات"`
  - `"connectors.title": "الموصّلات"` → `"connectors.title": "جسر الدردشة"`
- [ ] Run it green. `source ~/.zshenv && pnpm vitest run src/app/\(app\)/settings/developer/connectors/connectors-taxonomy.test.ts` — all three cases pass.
- [ ] Commit. `git add messages/en.json messages/es.json messages/ar.json "src/app/(app)/settings/developer/connectors/connectors-taxonomy.test.ts" && git commit -m "fix(connectors): rename colliding section headings to Database sync + Chat bridge (#196)"`

---

## L2 — Unify the create-button verb per section (#197 / live-audit #196)

Both sections expose a primary create button; today they read "New connector" (DB section, `create-connector-flow.tsx:53` via `connectorsDb.create`) and "Add connector" (chat section, `connectors-panel.tsx:38` via `connectors.add`). Unify on the verb **"New"** and name each section's own object, matching the L1 headings: DB → "New database sync", Chat → "New chat bridge". Value-only edits to the existing `connectorsDb.create` and `connectors.add` keys (both already wired through `useT()`), guarded by extending the L1 test.

**Files:**
- Modify: `messages/en.json`
- Modify: `messages/es.json`
- Modify: `messages/ar.json`
- Modify: `src/app/(app)/settings/developer/connectors/connectors-taxonomy.test.ts`
- (No component edits — `create-connector-flow.tsx:53` already renders `t('connectorsDb.create')`; `connectors-panel.tsx:38` already renders `t('connectors.add')`.)

Steps:

- [ ] Extend the test with a failing verb-consistency case. Add this `it` block inside the `describe` in `connectors-taxonomy.test.ts`:
  ```ts
  it('uses the unified verb "New" for both section create buttons (#197)', () => {
    expect((en as Catalogue)['connectorsDb.create']).toBe('New database sync');
    expect((en as Catalogue)['connectors.add']).toBe('New chat bridge');
    expect((es as Catalogue)['connectorsDb.create']).toBe('Nueva sincronización de bases de datos');
    expect((es as Catalogue)['connectors.add']).toBe('Nuevo puente de chat');
    expect((ar as Catalogue)['connectorsDb.create']).toBe('مزامنة قاعدة بيانات جديدة');
    expect((ar as Catalogue)['connectors.add']).toBe('جسر دردشة جديد');

    // English buttons share the same leading verb token.
    for (const key of ['connectorsDb.create', 'connectors.add'] as const) {
      expect((en as Catalogue)[key].split(' ')[0]).toBe('New');
    }
  });
  ```
- [ ] Run it red. `source ~/.zshenv && pnpm vitest run src/app/\(app\)/settings/developer/connectors/connectors-taxonomy.test.ts` — the new case fails: `connectorsDb.create` is "New connector", `connectors.add` is "Add connector".
- [ ] Apply the en rename. In `messages/en.json`:
  - `"connectorsDb.create": "New connector"` → `"connectorsDb.create": "New database sync"`
  - `"connectors.add": "Add connector"` → `"connectors.add": "New chat bridge"`
- [ ] Apply the es rename. In `messages/es.json`:
  - `"connectorsDb.create": "Nuevo conector"` → `"connectorsDb.create": "Nueva sincronización de bases de datos"`
  - `"connectors.add": "Añadir conector"` → `"connectors.add": "Nuevo puente de chat"`
- [ ] Apply the ar rename. In `messages/ar.json`:
  - `"connectorsDb.create": "موصل جديد"` → `"connectorsDb.create": "مزامنة قاعدة بيانات جديدة"`
  - `"connectors.add": "إضافة موصِّل"` → `"connectors.add": "جسر دردشة جديد"`
- [ ] Run it green. `source ~/.zshenv && pnpm vitest run src/app/\(app\)/settings/developer/connectors/connectors-taxonomy.test.ts` — all cases pass.
- [ ] Commit. `git add messages/en.json messages/es.json messages/ar.json "src/app/(app)/settings/developer/connectors/connectors-taxonomy.test.ts" && git commit -m "fix(connectors): unify section create-button verb on \"New\" (#197)"`

---

## L-GATE — Plan L verification gate (HOLD for GO)

GitHub-hosted runners only. Zero-deferral: every command below must be green before this plan is considered done. Run from repo root with `source ~/.zshenv && ` prefix.

- [ ] **Lint (0 errors).** `source ~/.zshenv && pnpm lint` — Biome reports 0 errors. Accept Biome auto-fixes (import order / line reflow) if any, then re-run to confirm clean.
- [ ] **Typecheck.** `source ~/.zshenv && pnpm typecheck` — `tsc --noEmit` passes (the JSON-import test relies on `resolveJsonModule`, already enabled for the existing `messages.ts` import path).
- [ ] **i18n none-new.** Confirm no keys were added or removed — only values changed. `source ~/.zshenv && python3 -c "import json; ks=[sorted(json.load(open(f'messages/{l}.json')).keys()) for l in ('en','es','ar')]; assert ks[0]==ks[1]==ks[2], 'locale key sets diverged'; print('i18n key parity OK:', len(ks[0]), 'keys')"` — prints parity OK, all three locales identical key sets, none added.
- [ ] **Full test suite.** `source ~/.zshenv && pnpm vitest run` — entire suite green (Testcontainers Postgres required; ensure Colima/Docker is up via `colima start` if the daemon is down). The new `connectors-taxonomy.test.ts` is included.
- [ ] **Build.** `source ~/.zshenv && pnpm build` — `next build` + entrypoint `tsc` succeed.
- [ ] **Route-reachability smoke (nav group).** Confirm `/settings/developer/connectors` still renders for an admin and now shows the two renamed sections. Via the e2e UI-acceptance gate: sign in as a workspace admin, navigate to `/settings/developer/connectors` (200, no redirect to `/settings/developer`), assert the page contains both heading texts "Database sync" and "Chat bridge" and that no element renders the literal old heading "Database connectors" or a bare "Connectors" section title.
- [ ] **Per-feature deployed-image check (e2e UI-acceptance gate).** On the deployed image, visually verify on `/settings/developer/connectors`:
  - DB-sync section heading reads "Database sync"; its primary create button reads "New database sync".
  - Chat-bridge section heading reads "Chat bridge"; its primary create button reads "New chat bridge".
  - The page no longer presents two sections that both read as "connectors", and the two create buttons share the leading verb "New".
- [ ] **Single PR onto `patches/v0.9.9`.** Plan L lands as part of the single v0.9.9 PR onto `patches/v0.9.9` (no direct main, no separate branch). **HOLD for user GO** before merging.
