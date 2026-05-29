# Cairn UX Audit Patches — Round 2 (post-v0.9.3) Index

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Context:** v0.9.3 shipped the first patch round (audit items 1–36 + #47/#48/#49). A deeper deploy review found ~half of the round-1 fixes didn't hold + 31 new findings. This round (→ **v0.9.4**) addresses them on a single branch `patches/ux-audit-v0.9.4`, one PR, held for review.

**Tech stack / verify gate:** unchanged — `source ~/.zshenv && pnpm lint && pnpm typecheck && pnpm test`; UI/route changes also `pnpm build`. New UI strings must pass the i18n gate (`pnpm i18n:check`; regenerate via `pnpm i18n:baseline` if needed). New interactive controls must hold WCAG AA contrast + ≥44px touch targets (a11y CI gate). Reuse the v0.9.3 `ui/select` + `ui/date-field` primitives.

---

## Reopened round-1 issues (v0.9.3 fix did NOT hold in deploy)

These were closed by PR #46 but reopened after the deploy review. Each plan that touches one must **first diagnose why the v0.9.3 attempt didn't resolve it** before re-fixing.

| GH | title | round-1 attempt | round-2 plan |
|---:|-------|-----------------|--------------|
| #15 | version footer link | P02 (link added) | P18 |
| #17 | duplicate top-right control box | P03 (toggles consolidated) | P13 |
| #18 | empty whitespace / column | P03 (padding) | P13 |
| #19 | empty DB block header row | P03 (header render) | P13 |
| #20 | headings inside callouts full size | P03 (CSS scale) | P13 |
| #27 | /my-tasks native date | P01 (DateField) | P19 |
| #29 | /notifications native dates | P01 (DateField) | P17 |
| #30 | mentions/replies pills active state | P06 | P17 |
| #34 | "Create key" grey pill | P07 (variant) | P19 |
| #39 | editor tab strip separators/active | P03 | P13 |
| #42 | sidebar resize handle | P02 (deferred — border only) | P18 |
| #44 | sign out separation | P02 (divider) | P18 |

## New findings (GitHub #50–#80)

| GH | summary | plan |
|---:|---------|------|
| #50 | MCP endpoint hardcoded localhost | P14 |
| #51 | templates grid orphan card | P11 |
| #52 | template badges identical | P11 |
| #53 | template Preview raw ► | P11 |
| #54 | palette literal "Mod+Shift+F" | P12 |
| #55 | palette shortcut shown for one action only | P12 |
| #56 | palette placeholder scope | P12 |
| #57 | default Note callout reads as "selected" | P13 |
| #58 | code-block "Auto" label unclear | P13 |
| #59 | toggle empty content placeholder | P13 |
| #60 | admin link non-functional | P15 |
| #61 | admin section unbuilt (404s) | P15 |
| #62 | members: owner Remove button | P16 |
| #63 | members: role lowercase | P16 |
| #64 | members: no Invite CTA | P16 |
| #65 | general: home-page native select | P16 |
| #66 | general: 2FA-required no enforcement | P16 |
| #67 | workspace settings sidebar no sub-page nav | P16 |
| #68 | security: no WebAuthn/passkey | P17* |
| #69 | security: no recovery-codes UI | P17* |
| #70 | security: no sessions / sign-out-all | P17* |
| #71 | security: "Set up 2FA" grey pill | P17* |
| #72 | notifications: only 2 event types | P17 |
| #73 | notifications: email/digest clickable w/o SMTP | P17 |
| #74 | notifications: SMTP banner red→neutral | P17 |
| #75 | page "…" menu no icons | P18 |
| #76 | page "…" menu missing actions | P18 |
| #77 | workspace switcher no icon/avatar | P18 |
| #78 | workspace switcher no Esc/click-outside | P18 |
| #79 | slash menu no icons | P18 |
| #80 | outline panel wide column | P18 |

\* Security group (#68–#71) is split: #71 (button style) is trivial polish; #68/#69/#70 are **net-new feature surfaces** (WebAuthn UI, recovery-codes UI, sessions list) — larger, may warrant their own dedicated plan (P17-security) and could slip to a follow-up release if scope balloons. Flag during planning.

## Plan files (this round)

- **P11** `…-12-templates-polish.md` — #51, #52, #53
- **P12** `…-13-command-palette.md` — #54, #55, #56
- **P13** `…-14-editor-blocks.md` — #57, #58, #59 + reopened #17,#18,#19,#20,#39
- **P14** `…-15-mcp-endpoint-origin.md` — #50
- **P15** `…-16-admin-section.md` — #60, #61
- **P16** `…-17-workspace-settings.md` — #62, #63, #64, #65, #66, #67
- **P17** `…-18-security-and-notifications.md` — #68–#74 + reopened #29, #30
- **P18** `…-19-menus-nav-chrome.md` — #75–#80 + reopened #15, #42, #44
- **P19** `…-20-reopened-formcontrols.md` — reopened #27, #34 + a diagnose-first checklist for all reopened items

## Execution order

Cosmetic/low-risk first (P11, P12, P13, P18), then settings surfaces (P15, P16, P17), MCP (P14), reopened re-fixes (P19) interleaved with their thematic plans. Single branch → single PR → hold for review → v0.9.4.
