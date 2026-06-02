# v0.9.9 Scope & Plan Index

> # ⛔ HOLD — Plan A brainstormed, awaiting user GO
> No code on `patches/v0.9.9` beyond docs. Each plan = single PR, gated by explicit GO before the next starts.

**112 audit findings → 93 open GH issues (#185–277), 13 tagged `regression`.** Full retrospective + per-finding detail: `docs/superpowers/audit-v0.9.8.md`. Each plan letter below is a standalone doc with bite-sized TDD steps.

## Release constraints (locked)
- Branch `patches/v0.9.9` · **single PR per plan** · no direct main · **GitHub-hosted runners only** (no self-hosted).
- Biome **0 errors** · i18n en/es/ar for new strings · zero-deferral.
- **Full `pnpm vitest run` in every per-group gate** (v0.9.8 lesson — not just touched files).
- **NEW e2e UI-acceptance gate:** route-reachability Playwright smoke (every sidebar/settings slug → 200 + known element) + per-feature deployed-image check. The missing gate that let 12 features regress (see retrospective).

## Migrations (v0.9.9 starts at 0062)
- **0062** notification types (Plan I4 / #195) · **0063** cover backfill (Plan M6 / #214) · **0064** avatar column (Plan K5 / #199, if in-scope) · row-body if Plan F1 row-detail needs it · comment_reactions if Plan T2 stretch shipped.

---

## Plans (20) — letter → file → findings

| Plan | File | Theme | Key issues |
|------|------|-------|-----------|
| **A** | [plan-a-critical-regressions](v0.9.9-plan-a-critical-regressions.md) | Critical regressions (P0) | #80 #1 #38/76/77/111/112 #2/3/4 #72 |
| **B** | [plan-b-per-page-acl-ui](v0.9.9-plan-b-per-page-acl-ui.md) | Per-page ACL UI (P0, v0.7.0) | #94/#259 |
| **C** | [plan-c-nav-surfaces](v0.9.9-plan-c-nav-surfaces.md) | Nav surfaces + sidebar shell | #28/29/30-34 #5 #6/7 #8 |
| **D** | [plan-d-editor-polish-a11y](v0.9.9-plan-d-editor-polish-a11y.md) | Editor polish & a11y | #10 #11 #9 #83/84/86 #107 #108 #101 #55 |
| **E** | [plan-e-slash-ux-consistency](v0.9.9-plan-e-slash-ux-consistency.md) | Slash UX consistency | #104 #64 #73 |
| **F** | [plan-f-database-depth](v0.9.9-plan-f-database-depth.md) | Database depth | #62 #65/66 #71 #67/95 #87 #40 #39 |
| **G** | [plan-g-search-refresh](v0.9.9-plan-g-search-refresh.md) | Search & refetch consistency | #75 #88 #41 |
| **H** | [plan-h-security-ux](v0.9.9-plan-h-security-ux.md) | Security UX | #12 #13 #14 #89 #90 #96/100 |
| **I** | [plan-i-empty-states](v0.9.9-plan-i-empty-states.md) | Empty states + notif/webhook matrix | #42/43 #23 #15 #16 #78/79 #24 |
| **J** | [plan-j-theme-light-mode](v0.9.9-plan-j-theme-light-mode.md) | Theme & light mode | #44 #45 #21 #22 |
| **K** | [plan-k-workspace-onboarding](v0.9.9-plan-k-workspace-onboarding.md) | Workspace onboarding | #36/27 #37 #46/47 #19 #20 |
| **L** | [plan-l-connectors-taxonomy](v0.9.9-plan-l-connectors-taxonomy.md) | Connectors taxonomy | #17 #18 |
| **M** | [plan-m-cover-icon-polish](v0.9.9-plan-m-cover-icon-polish.md) | Cover & icon polish | #49 #50 #51 #60 #52 #35 |
| **N** | [plan-n-export-publish](v0.9.9-plan-n-export-publish.md) | Export & publish | #56 #61 #70 |
| **O** | [plan-o-read-focus-mode](v0.9.9-plan-o-read-focus-mode.md) | Read & focus mode | #57 #58 #59 #63 |
| **P** | [plan-p-templates](v0.9.9-plan-p-templates.md) | Templates | #68 #69 #63 |
| **Q** | [plan-q-audit-log-polish](v0.9.9-plan-q-audit-log-polish.md) | Audit log polish | #91 #92 #93 |
| **R** | [plan-r-mint-token-tooltips](v0.9.9-plan-r-mint-token-tooltips.md) | Mint-token tooltips | #106 |
| **S** | [plan-s-suggest-edits-drawer](v0.9.9-plan-s-suggest-edits-drawer.md) | Suggest-edits drawer | #53 #54 |
| **T** | [plan-t-comments](v0.9.9-plan-t-comments.md) | Comments | #74 (#T2 reactions = stretch) |

## Build order (gate each before next)
**A → B → D → C → F → H → G → E → K → J → I → L → M → N → S → T → Q → P → O → R**

Rationale: P0 regressions first (A), then the v0.7.0 security gap (B); editor correctness (D) + nav shell (C) early since most-used surfaces; database depth (F) + security UX (H) mid; refetch/slash consistency (G/E); onboarding/theme/empty-states (K/J/I); taxonomy + polish (L–R) last. P3-heavy plans (O, R) trail.

## Pre-build (independent of code)
**Redeploy `ghcr…:v0.9.8` + run entrypoint migrator** → clears #185 + the #2/#3/#5 stale-deploy misreports before Plan A even lands.

---

## Regression & e2e-gate analysis
See `docs/superpowers/audit-v0.9.8.md` lead section — 13 features marked "done" in prior releases (sign-out v0.1.0, per-page ACL v0.7.0, slash parser v0.9.6, …) regressed because scope was checklist-completed without UI acceptance on a deployed image. The new e2e UI-acceptance gate (above) is the structural fix.
