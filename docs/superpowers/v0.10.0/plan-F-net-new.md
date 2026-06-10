# Plan F — net-new features

> **HOLD until GO.**

Three genuinely-new surfaces (no backend exists to wire — these build from
scratch). Ships **after** Plan G so the hardening lands before the surface
widens. F1/F2 add migrations — both backfill existing rows (the A3 lesson).
F3 (onboarding tour) is the **declared first cut candidate** if scope slips
(README order: F3, then E6, then E5).

## F1 — Workspace brand: logo + primary color

**Exists:** workspace icon (emoji/uploaded, shipped v0.9.x). **Missing:** a
brand **logo** (distinct from the small icon — appears in the sidebar header and
on public `/s/<slug>` pages) and a **primary-color override** that retints the
accent token per workspace.

**Build:** migration adding `workspaces.brand_logo_file_id` (FK to `files`) +
`workspaces.brand_primary_color` (text, nullable — null = default theme accent).
Backfill is trivial (both null = today's behavior, so no behavior change for
existing rows, but the migration still asserts the columns exist on old rows).
A brand section in Workspace settings (logo upload reusing `FileStorage` + the
HMAC-signed URL path; color picker writing an OKLCH-safe value). Apply the
primary color by setting the CSS custom property at the workspace layout root;
fall back to the theme accent when null.

**Failure modes verified:**
- Color contrast: a user-picked primary that fails 4.5:1 against on-primary text
  → the picker warns and the applied token clamps to an accessible lightness
  (the accessibility-CRITICAL rule; spec picks a near-white accent, asserts the
  rendered button text stays legible).
- Logo on the PUBLIC page loads through a signed URL, not a raw path, and is
  visible to anonymous visitors (spec hits `/s/<slug>` logged-out).
- Null brand_primary_color → the workspace renders the default theme accent
  unchanged (no-regression spec on an un-branded workspace).
- Dark mode: the primary override is applied in both light and dark (paired —
  the `dark-mode-pairing` rule; spec toggles theme, asserts the accent tracks).
- Editor/viewer can SEE the brand; only admin/owner can change it (role spec).

## F2 — Custom slash commands → templates

**Exists:** the slash menu is a fixed registry; "save as template" exists for
pages (v0.9.0 P25). **Missing:** any user-defined slash command that inserts a
saved template at the cursor.

**Build:** migration adding `workspace_slash_commands` (id, workspace_id,
trigger text, target template_id, label, enabled) — backfill is an empty set per
workspace (no rows = today's fixed menu only). A management UI (Workspace
settings: list/create/delete, pick trigger + template). Extend the slash
extension to merge workspace commands into the menu under a "Workspace" group,
inserting the referenced template's content at the cursor through the editor
command pipeline (the C3 Yjs lesson — go through `insertContent`, never a raw
doc swap, so it replicates to collaborators).

**Failure modes verified:**
- A custom command inserts the template at the cursor and the insert replicates
  to a second collaborator over Yjs (two-client spec).
- Trigger collision with a built-in (`/todo`) → validation rejects or
  namespaces it; built-ins are never shadowed silently (spec attempts a
  colliding trigger, asserts the error).
- Deleting the target template disables the command (or marks it broken) rather
  than inserting nothing on fire (spec deletes the template, asserts the command
  is flagged).
- `allowedPrefixes` re-trigger: typing the custom trigger after a word char
  still opens the menu only where built-ins would (the `@tiptap/suggestion`
  `allowedPrefixes:[' ']` lesson — spec types mid-word, asserts no spurious
  fire).
- Tenant isolation: workspace A's commands never appear in workspace B's menu
  (spec switches workspace, asserts the menu set changes).

## F3 — Onboarding tour (element-anchored walkthrough)

**Exists:** the onboarding **wizard** (v0.8.0 P10, a full-screen multi-step) +
the welcome template. **Missing:** an in-product, element-anchored TOUR that
points at real UI (sidebar, ⌘K, slash menu, share) on first run — distinct from
the wizard's modal flow.

**Build:** a lightweight anchored-popover tour (no new heavy dep — reuse the
existing popover/floating primitives) driven by a step list (selector + copy +
placement); per-user `last_seen_tour_version` so it shows once and can be
re-triggered from Help. Steps anchor to stable `data-tour` hooks added to the
real elements.

**Failure modes verified:**
- First run shows step 1 anchored to the real sidebar element; Next advances;
  Done sets the seen-marker so a reload doesn't re-show (spec runs first-load,
  completes, reloads, asserts no tour).
- `prefers-reduced-motion` → the tour still works with no/instant transitions
  (the reduced-motion CRITICAL rule).
- Keyboard: Tab/Enter/Esc drive and dismiss the tour (focus stays trapped in the
  popover, Esc = skip — the `escape-routes` rule).
- An anchor element that isn't mounted (e.g. tour step targets a panel the role
  can't see) → the step is skipped, not a tour stuck on a missing selector (spec
  runs the tour as a viewer, asserts admin-only steps skip).
- Re-trigger from Help replays the tour regardless of the seen-marker (spec).

## Cut discipline

If the release runs long, F3 is cut first (declared in the README), reported
explicitly in the release notes — never silently dropped. F1 (brand) and F2
(custom slash) are the higher-value net-new pair and ship before F3.
