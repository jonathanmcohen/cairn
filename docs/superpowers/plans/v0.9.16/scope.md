# v0.9.16 Scope — consolidated

> # ⛔ HOLD — plan only. No code beyond what's already in PR #320 until GO per plan group.
> Branch `release/v0.9.16` (already has Plan A/B = #142/#143). Self-hosted runners · Biome 0 errors · i18n en/es/ar · full vitest in every gate · controller pushes.

## LIVE-VERIFICATION GROUND TRUTH (this sweep)

The live deploy at `cairn.local.jonco.dev` was browser-tested. **`/healthz` → `"version":"0.9.15"`, uptime ~4.7h — the deploy is CURRENT, not stale.** This overturns the earlier "stale deploy" theory AND the "carry-forward surviving multiple releases" premise:

| Reported "still broken" | Live v0.9.15 observed | Truth |
|---|---|---|
| **#1** `/settings/workspace/general` 500 (P0) | Page **loads fine** (screenshot, no 500) | **Already fixed live** (v0.9.15 #1 + fresh migrate). Stale backlog item. |
| **#143** switch leaves sidebar stale | **Reproduces live** (on "test": PAGES empty but Saved-Searches "important" + Review-due "5" persist) | Real → **fixed in PR #320** (pending merge/deploy). |
| **#142** workspace icon badge | Badge shows letter; picker shows generic doc (test has no icon set) | Badge-render gap → **fixed in PR #320**. |
| **Plan V** test-infra split | 21-job matrix already in `ci.yml` on main | **Already shipped** (v0.9.14). No Plan V to "land first." |

**Conclusion:** the carry-forward list (Plan G) is a **stale backlog** — items shipped in v0.9.14/v0.9.15 and present on the live v0.9.15 build; #1 is *proven* working live. Re-building them is a no-op with re-break risk. The genuinely-new/real work in v0.9.16 is **Plan F (MCP OAuth)**, **Plan C (top-sidebar density)**, and **#142/#143 (PR #320, done)**.

## Plan index + order

| Plan | What | Status | File |
|---|---|---|---|
| **A** #142 workspace icon badge | switcher renders icon (InlineIcon) | ✅ done — **PR #320** | (in flight) |
| **B** #143 switch stale sidebar | hard-nav on switch | ✅ done — **PR #320** | (in flight) |
| **C** top-sidebar density (#144) | switcher 32 / palette 36 / headers / PAGES 28px, pointer-coarse 44 floor | 📋 planned | [plan-C-top-sidebar-density.md](plan-C-top-sidebar-density.md) |
| **F** MCP OAuth 2.1 | AS + PKCE + dynamic reg + consent + WWW-Authenticate + revoke; PAT backward-compat | 📋 planned (11 tasks, migration 0069) | [plan-F-mcp-oauth.md](plan-F-mcp-oauth.md) |
| **G** carry-forward closer | A3/B3/B5/C1/E4/K2/#76/D1/D2/Plan-U/Plan-V | 🔎 **verification doc** (mostly shipped) | [plan-G-carry-forward-status.md](plan-G-carry-forward-status.md) |

**Execution order (recommended): merge PR #320 (A/B) → C → F → (G = verify-live, no rebuild).** Plan V is already shipped; nothing to run.

Supporting: [audit-v0.9.15-retrospective.md](audit-v0.9.15-retrospective.md).

## Notes
- Docs live under `docs/superpowers/plans/v0.9.16/` (the established per-release convention; the directive's `docs/superpowers/v0.9.16/` was the older path — all release folders were consolidated into `plans/`).
- Plan F is the centerpiece — a real new feature, fully grounded against the existing PAT/MCP auth path (`src/lib/auth/token.ts`, `src/app/api/mcp/route.ts`), next migration `0069`.
