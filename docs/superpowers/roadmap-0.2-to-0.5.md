# Cairn Roadmap: v0.2.0 → v0.5.0

> Status: **proposal**. This maps the spec's deferred features (`docs/superpowers/specs/2026-05-20-cairn-design.md` §2) into four themed minor releases. Each release becomes its own spec + sequence of bite-sized plans (same workflow as v0.1.0). Nothing here is committed until brainstormed and approved.

v0.1.0 shipped: workspaces/auth/roles, pages + block editor, search, trash, files + markdown, inline databases, multi-arch ghcr.io release.

The four releases below each have a single theme so they ship as coherent units. Ordering reflects dependencies and rising infrastructure risk.

---

## v0.2.0 — Access & sharing

**Theme:** expand *who* can get in and *what* they can reach. No new infrastructure services; mostly auth config + new access paths.

| Feature | Notes / risk |
|---|---|
| **OAuth providers** (Google, GitHub) | Auth.js v5 makes this largely config + env. The DrizzleAdapter is already wired (currently inert under the credentials/jwt setup). Main work: provider env plumbing, account-linking UI, first-OAuth-user → workspace bootstrap. **Low risk.** |
| **Multi-workspace switching** | One instance, a user in multiple workspaces, a switcher in the sidebar. Requires: removing the "first member row wins" assumption in `getAuthContext` (add an active-workspace selector, stored in session/cookie), a workspace-create flow, and an invite-accept flow that adds an existing user to another workspace. **Medium risk** — touches the auth context that every route depends on. |
| **Public read-only sharing** | Per-page "publish" toggle producing an unauthenticated read-only link. Needs a public render path that bypasses `requirePageAccess`, a `published` flag + public slug on pages, and careful scoping (published pages only, no edit, no children unless opted in). **Medium risk** — first code path that serves content without a session. |
| **Block-level permissions** *(stretch)* | Spec lists this for v0.3.x+; could ride along if cheap, but more likely deferred. |

**Rough size:** ~3 plans (OAuth, multi-workspace, public sharing). Comparable to Plan 3 each.

---

## v0.3.0 — Real-time collaboration

**Theme:** make it multiplayer. This is the biggest infrastructure change in the whole roadmap — it breaks the single-process assumption.

| Feature | Notes / risk |
|---|---|
| **Real-time collaborative editing (Yjs)** | `yjs` + `y-prosemirror` + a WebSocket relay (Hocuspocus or `y-websocket`). The editor schema was kept Yjs-compatible from Plan 2. Storage model changes: the doc becomes a Yjs binary update log with periodic snapshots into `pages.content`. **High risk / high effort** — new WebSocket server (or sidecar), doc-merge semantics, presence, offline reconciliation. May warrant splitting into its own multi-plan effort. |
| **Presence** (live cursors, avatars) | Falls out of Yjs awareness protocol once the relay exists. |
| **Comments + @mentions** | Comment threads anchored to blocks/ranges; `@user` autocomplete scoped to workspace members. New tables + UI. **Medium.** |
| **Notifications** | In-app notification feed for mentions/comments. New table + polling or the same WS channel. **Medium.** |

**Operational note:** real-time collab contradicts the v0.1.0 "single process, no horizontal scaling" non-goal. v0.3.0 must decide: keep the WS relay in-process (simplest, still single-instance) vs. a separate service. Recommend in-process for homelab scale; document the scaling ceiling.

**Rough size:** ~4-6 plans. Yjs alone is 2-3.

---

## v0.4.0 — Database depth

**Theme:** bring inline databases to real Notion parity. Self-contained within the database subsystem built in v0.1.0 Plan 5.

| Feature | Notes / risk |
|---|---|
| **Formulas** | A formula property type with an expression language (parse + evaluate over a row's cells). Decide: evaluate in JS at read time vs. computed columns. **Medium-high** — needs a small expression parser/evaluator and a function library. |
| **Relations** | Link rows across databases (a `relation` property pointing at another database; bidirectional sync). New cell value shape + referential integrity. **Medium.** |
| **Rollups** | Aggregate a related database's property (sum/count/etc.) through a relation. Depends on relations landing first. **Medium.** |
| **Calendar + timeline views** | Two new view types keyed on a date property. Mostly UI; the view/filter/sort infra already exists. **Low-medium.** |

**Rough size:** ~4 plans (formulas, relations, rollups, calendar+timeline). Relations must precede rollups.

---

## v0.5.0 — Platform & operations

**Theme:** turn Cairn from an app into a platform, and make it production-grade to operate.

| Feature | Notes / risk |
|---|---|
| **Public API + webhooks** | Tokened REST API (API keys per workspace) over the existing lib helpers; outbound webhooks on page/row events. **Medium** — auth model for API keys, rate limiting, event dispatch. |
| **Templates gallery** | Save a page/subtree (or database) as a reusable template; instantiate into a workspace. Builds on markdown/subtree-export machinery. **Low-medium.** |
| **Page version history** | Periodic content snapshots + a diff/restore UI. New `page_versions` table; ties into autosave. **Medium.** |
| **S3 / MinIO file backend** | Implement the `S3Storage` class behind the existing `FileStorage` interface (the seam is already there from v0.1.0 Plan 4). Config-selected backend. **Low** — interface already abstracts it. |
| **Backup / restore CLI** | A `cairn backup` / `cairn restore` command (pg_dump + uploads volume tar, or logical export). **Low-medium.** |

**Rough size:** ~5 plans.

---

## Out of this roadmap (separate tracks)

- **Native mobile apps** — the spec lists these for v0.3.x+, but a React Native / native client is a parallel track with its own lifecycle, not a blocker for the 0.x web releases. Revisit after 0.5.0 or spin up alongside if there's demand.
- **AI/LLM features, desktop (Electron), E2E encryption** — explicitly out of scope per the v0.1.0 spec; no change.

---

## Suggested sequence & rationale

1. **0.2.0 (Access)** first — cheap, foundational, unblocks real multi-user use without the heavy infra of collab.
2. **0.3.0 (Realtime)** next — the marquee feature; do it once multi-workspace/auth is stable so the collab work isn't fighting auth churn.
3. **0.4.0 (Database depth)** — self-contained; can be slotted earlier if databases are a higher priority than realtime for the actual users.
4. **0.5.0 (Platform & ops)** last — API/templates/versioning/backup are most valuable once the feature set is stable.

**This ordering is a recommendation, not fixed.** If the homelab's actual users care more about (say) database formulas than realtime collab, swap 0.3 ↔ 0.4. The themes are independent enough to reorder.

---

## Next step

Pick the first release to brainstorm in depth. The normal flow is: brainstorm → write spec → write numbered plans → execute subagent-driven (exactly as v0.1.0). Recommend starting with **0.2.0 (Access & sharing)** unless priorities differ.
