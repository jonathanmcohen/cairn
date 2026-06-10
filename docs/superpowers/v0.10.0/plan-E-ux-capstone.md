# Plan E — UX capstone

> **HOLD until GO.**

Two small items; E2 ships last in the release so the panel can announce
v0.10.0 itself.

## E1 — `?` opens the shortcuts cheat sheet (seed 25) — UI-incomplete (tiny)

**Exists:** the sheet is complete (`shortcuts/sheet.tsx:14-75` — grouped,
i18n, kbd-rendered, Escape-to-close) registered as `Mod+/`
(`app-shortcuts.ts:89-98`). **Missing:** the bare `?` convention — the
dispatcher early-returns on any non-modifier key
(`dispatcher.tsx:88-90` `if (!mod) return`).

**Build:** register `?` (match on `e.key === '?'`, layout-independent) and
relax the dispatcher to allow it ONLY when focus is not in an
input/textarea/contenteditable. `Mod+/` stays.

**Failure modes verified:**
- Typing `?` inside the TipTap editor or any input does NOT open the sheet
  (the focus-guard spec — the highest-risk regression).
- `?` and `Mod+/` resolve to distinct registry entries (no normalizeKeys
  collision).
- Non-US layouts: binding keys off `e.key === '?'`, not the physical Shift+/
  position (unit test dispatches the key directly).
- The sheet's own listing + tooltips show both triggers (stale-copy check).

## E2 — "What's new" release-notes panel (seed 28) — Backend-stub

**Exists:** sidebar `v{version}` external GitHub link
(`sidebar-footer-nav.tsx:74-84`); admin upgrade page links release notes only
when an UPGRADE is pending (`settings/admin/upgrade/page.tsx:80-106`);
release-watch notifications carry `{version, releaseNotesUrl}`. **Missing:**
any in-app panel for the running version's notes.

**Build:** an in-app What's-new panel (sheet/dialog from the sidebar version
chip) rendering the CURRENT version's CHANGELOG section, with a per-user
`last_seen_version` so it badges once after an upgrade; all roles, not just
admins.

**Failure modes verified:**
- Per-user seen-marker: bump version → panel badges once → dismiss → stays
  dismissed across sessions (no every-login re-pop, no never-shows).
- CHANGELOG.md sourcing must survive `output:'standalone'` (bundle the parsed
  notes at build, or ship a generated JSON — spec asserts the panel renders in
  the production image, the exact tree-shake trap).
- Viewer-role user sees the panel (not admin-only — the release-watch audience
  trap).
- Version compare handles local dev builds newer than the latest tag without
  showing stale notes.

## Release flow note

After B → C → D → E merge: version bump + CHANGELOG `[0.10.0]`, RC tag,
`v0.10.0-rc1 IMAGE READY — pull and verify`, hard-stop for user verification
(incl. a live-deploy sweep with the corrected verification methods from
plan-B B2), then final tag on user VERIFIED.
