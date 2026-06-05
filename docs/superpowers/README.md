# Superpowers docs — release planning archive

Planning, scope, audit, and postmortem docs for each Cairn release. **One folder per release tag.**

## Convention

```
docs/superpowers/
├── README.md                        ← this file
├── v0.9.9/                          ← one folder per release tag
│   ├── scope.md                     ← release index (themes, build order, constraints)
│   ├── plan-{letter}-{slug}.md      ← one per plan group (A, B, C, …)
│   └── audit-vX.Y.Z-retrospective.md← the audit that motivated this release
├── v0.9.10/
│   ├── scope.md
│   └── migration-journal-postmortem.md
└── v0.9.11/
    ├── scope.md
    ├── plan-{letter}-{slug}.md
    ├── polish-audit.md              ← design/UX audit (when a release has a polish pass)
    └── audit-v0.9.10-retrospective.md
```

### Standard file names (inside a `vX.Y.Z/` folder)
| File | Purpose |
|------|---------|
| `scope.md` | Release index: HOLD banner (while planning), themes, plan letter→file table, build order, locked constraints, migration plan. |
| `plan-{letter}-{slug}.md` | One implementation plan per theme group, TDD bite-sized steps. |
| `audit-vX.Y.Z-retrospective.md` | The audit of the **previous** release that this release remediates (lives with the release that fixes it, named for the version audited). |
| `polish-audit.md` | Design/UX (Notion-polish) audit, when applicable. |
| `*-postmortem.md` | Root-cause writeup for an incident this release fixes. |

### Rules
- New release → new `vX.Y.Z/` folder. Don't add release docs at the top level.
- Keep the audit doc with the release that **addresses** it, named for the version **audited** (e.g. v0.9.9 fixed the v0.9.8 audit → `v0.9.9/audit-v0.9.8-retrospective.md`).
- `git mv` when relocating so blame history survives.
- Top-level non-release docs (roadmaps, cross-release retrospectives, `notes/`, smoke reports) stay at the top level.

## Index

| Release | Status | Folder |
|---------|--------|--------|
| v0.9.9 | shipped (audit remediation, plans A–T) | [`v0.9.9/`](v0.9.9/) |
| v0.9.10 | shipped (migration hotfix) | [`v0.9.10/`](v0.9.10/) |
| **v0.9.11** | **planning — HOLD** (flashcards #114-116, profile #126, color #127, sidebar density #130-133, Plan U polish) | [`v0.9.11/`](v0.9.11/) |

Top-level (not release-scoped): `roadmap-*.md`, `retrospective-v0.7-v0.8.md`, `v0.9.{0,1}-smoke-report.md`, `notes/`, `specs/`, `plans/`.
