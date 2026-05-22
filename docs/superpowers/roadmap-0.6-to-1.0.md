# Cairn Roadmap: v0.6.0 → v1.0.0

> Status: **proposal**. This maps the path from the current **v0.5.1** state (security-hardened platform) to a **stable, feature-complete, documented 1.0.0**. Each release becomes its own spec + sequence of bite-sized plans (same workflow as v0.1.0–v0.5.1). A companion detailed design exists at `docs/superpowers/specs/2026-05-22-cairn-v1.0.0-design.md`. Nothing here is committed until brainstormed/approved.

Shipped through **v0.5.1**: workspaces/auth/OAuth/RBAC, multi-workspace, pages + block editor, search, trash, files (local + S3/MinIO) + markdown, inline databases (table/kanban/gallery + formulas/relations/rollups/calendar/timeline), public sharing, realtime collab + presence + comments + @mentions + notifications, public REST API + API keys + webhooks + templates + page version history + backup CLI, and a security suite (isolation/RBAC/boundary/injection tests) + CSP/nonce + auth rate-limiting + `SECURITY.md`. Multi-arch (amd64+arm64) images published on `v*.*.*` tags via native per-arch runners.

The five releases below each carry a single theme so they ship as coherent units. Ordering reflects rising cross-cuttingness and the goal of declaring stability last.

---

## v0.6.0 — Content & database completeness

**Theme:** close the editor + database gaps that still separate Cairn from Notion parity. Self-contained in the editor/database subsystems; low infra risk.

| Feature | Notes / risk |
|---|---|
| **Reverse/bidirectional relations** | The most-requested item deferred from v0.4.0: a relation auto-maintains a mirror property on the target database. **Medium** — write-time sync both directions + avoiding loops. |
| **Database list view + table grouping + richer filters/sort** | A 4th view type (list), group-by inside table (like kanban), per-type filter operators (contains/before-after/is-empty), multi-sort UI. **Low-medium** — view/filter infra exists. |
| **Sub-items / row hierarchy** | Parent-row self-relation with expand/collapse in views. **Medium.** |
| **New block types** | Toggle/collapsible, multi-column layout, simple (non-database) table, embed (allowlist-only iframes), bookmark/URL-unfurl, math/LaTeX (KaTeX), **synced blocks** (one source, many mirrors). **Medium-high** — each must stay Yjs-serializable (the v0.3.0 collab constraint); synced blocks are the trickiest. |
| **Table of contents + outline** | Auto-TOC block from headings + a page outline sidebar. **Low.** |

**Rough size:** ~6 plans. (reverse relations; list/grouping/filters; sub-items; blocks pt.1; blocks pt.2 + synced; TOC/outline + release.)

---

## v0.7.0 — Sharing & collaboration depth

**Theme:** richer sharing surfaces + deeper multiplayer, on the stable collab layer.

| Feature | Notes / risk |
|---|---|
| **Per-page share settings** | Password-protected public links, link expiry, "allow duplication" toggle. (Chosen over true per-block ACLs for 1.0 — see non-goals.) **Medium.** |
| **Published multi-page public site** | A workspace's published pages as a navigable mini-site at `/s/<workspace-slug>`. **Medium** — extends the existing `/p/<slug>` anon path. |
| **Comments on databases + files** | Deferred from v0.3.0; anchor threads to a row or a file. **Medium.** |
| **Suggestion / track-changes mode** | Propose edits, accept/reject — built on Yjs. **High** — hardest collab surface. |
| **Email notifications** | BYO-SMTP (opt-in), digest + per-event, + a notification-preferences UI. **Medium** — no third-party email SaaS dependency (self-hostable). |

**Rough size:** ~5 plans.

---

## v0.8.0 — Mobile, accessibility & i18n

**Theme:** usable everywhere, by everyone. Cross-cutting polish — do it once the feature surface is mostly complete to avoid churn.

| Feature | Notes / risk |
|---|---|
| **Responsive / mobile-optimized UI** | Editor, sidebar drawer, database views adapt to small screens. **Medium.** |
| **PWA + offline** | Installable (manifest), service worker for offline READ of recent pages + queued edits synced on reconnect (Yjs helps). **High** — offline+sync is the riskiest correctness surface; scope to read-offline + simple queued edits, not full offline-first. Covers "mobile" for 1.0 (native apps deferred). |
| **Accessibility (WCAG 2.1 AA)** | Keyboard nav, focus management, ARIA, contrast, screen-reader testing; automated `axe` checks in CI. **Medium.** |
| **Keyboard-shortcut system** | Discoverable shortcut sheet (⌘/). **Low.** |
| **i18n scaffolding** | Externalize strings, locale switch, ship en + one more locale; RTL-ready CSS. **Medium.** |

**Rough size:** ~5 plans.

---

## v0.9.0 — Admin, observability, ops & import

**Theme:** operate it at scale; get data in and out. Operational maturity before declaring stable.

| Feature | Notes / risk |
|---|---|
| **Workspace admin console** | Member/role/invite management UI, workspace settings, **transfer ownership**, **delete workspace** (the v0.2.0 sole-owner follow-ups). **Medium.** |
| **Audit log** | Workspace-scoped record of sensitive actions (role changes, publishes, key/webhook CRUD, deletes) + viewer. **Medium.** |
| **2FA (TOTP) + recovery codes** | Optional per-user; admin can require it per workspace. (Passkeys/WebAuthn deferred.) **Medium.** |
| **Observability** | Structured JSON logging + a Prometheus `/metrics` endpoint (request/db/collab/webhook metrics). **Low-medium.** |
| **Quotas / limits** | Per-workspace storage + rate limits, surfaced in admin. **Low-medium.** |
| **Scheduled backups + import/export** | Cron-able backup + retention + optional S3 target (extends the v0.5.0 CLI); Notion (ZIP/HTML/MD) + Markdown-folder import (best-effort, documented gaps); full re-importable workspace export. **Medium-high** — Notion import fidelity is the risk. |

**Rough size:** ~6 plans.

---

## v1.0.0 — Stabilization, API stability, docs & polish

**Theme:** lock it down and call it 1.0. "1.0" for Cairn = **feature-complete** (Notion-parity self-hosted goal met), **stable** (frozen + documented public API, SemVer commitment, tested upgrade path), **documented** (a real docs site), **performant**, and **operable**.

| Feature | Notes / risk |
|---|---|
| **API stability + OpenAPI** | Freeze `/api/v1`, publish an OpenAPI 3.1 spec + a generated typed client, document the compatibility guarantee (breaking changes → `/api/v2` post-1.0). **Medium** — audit the surface before freezing. |
| **Performance pass** | Virtualized long pages + large database views, lazy heavy blocks, query/index audit, large-doc Yjs tuning, a Lighthouse budget in CI. **Medium.** |
| **Optional AI assist (BYO LLM)** | Summarize / continue-writing / ask-this-page via a bring-your-own OpenAI-compatible endpoint, **opt-in, off by default, self-hostable** (point at local Ollama/vLLM or any compatible URL); no content leaves the instance unless the operator configures an endpoint. **Medium** — the off-by-default + no-leak guarantee must be asserted in tests. |
| **Docs site** | Real documentation: install, configure, API, admin, security. **Low-medium.** |
| **Upgrade/migration guarantees** | Documented + tested migration path; optional checkpoint migration squash. **Low-medium.** |
| **Final security + dependency review** | Fresh pass over the v0.5.1 suite + a manual external-tool sweep; dependency refresh. **Low.** |
| **Polish + branding** | Onboarding, empty states, error pages, theming (custom logo/accent), command-palette completeness. **Low.** |

**Rough size:** ~6 plans.

---

## Out of this roadmap (deferred to post-1.0 / a 2.0 track)

- **Native mobile apps** (iOS/Android) — the PWA covers mobile for 1.0; native is a separate track with its own lifecycle.
- **End-to-end encryption** — out of the 0.x/1.0 scope; revisit for a 2.0 "private" track.
- **Desktop Electron app** — the installable PWA covers desktop.
- **SSO/SAML/SCIM, enterprise directory sync** — OAuth covers 1.0; enterprise auth is a post-1.0 track.
- **WebAuthn / passkeys** — TOTP 2FA covers 1.0.
- **True per-block ACLs** — per-page sharing covers 1.0.
- **Semantic / embeddings search** — opt-in generative assist only for 1.0.
- **Horizontal scaling** of the collab service (multi-replica + Redis pub/sub) — single-instance documented ceiling stays for homelab scale.
- **Plugin / marketplace system** — post-1.0.

---

## Suggested sequence & rationale

1. **v0.6.0 (content/db)** first — highest user-visible value, self-contained, low infra risk; gets Cairn to true editor/database parity.
2. **v0.7.0 (sharing/collab)** — builds on the stable collab layer; ships the sharing surfaces users ask for.
3. **v0.8.0 (mobile/a11y/i18n)** — cross-cutting; do it once the feature surface is mostly complete so there's less rework (note: implementers of 0.6/0.7 should not regress a11y/string-externalization to keep this cheap).
4. **v0.9.0 (admin/ops/import)** — operational maturity + data portability before stable.
5. **v1.0.0 (stabilize)** — freeze the API, performance, docs, opt-in AI, final review; declare SemVer.

**This ordering is a recommendation, not fixed.** If priorities shift (e.g. mobile sooner, or admin/ops earlier for a multi-user homelab), the themes are independent enough to reorder — except that **1.0.0 must come last** (it freezes everything before it).

≈ 28 plans across the five releases.

---

## Next step

Pick the first release to brainstorm in depth. The normal flow is: brainstorm → write spec → write numbered plans → execute subagent-driven (exactly as v0.1.0–v0.5.1). Recommend starting with **v0.6.0 (content & database completeness)**.
