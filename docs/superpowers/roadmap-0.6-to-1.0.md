# Cairn Roadmap: v0.6.0 → v1.0.0

> Status: **proposal**. Path from the current **v0.5.1** state (security-hardened platform) to a **stable, feature-complete, documented 1.0.0**. Per the user's direction, the formerly-separate themed minors (v0.6 content/db, v0.7 sharing/collab, v0.8 mobile/a11y/i18n, v0.9 admin/ops/import) are **consolidated into a single large v0.6.0 release**, followed by the v1.0.0 stabilization milestone. Detailed designs: `specs/2026-05-22-cairn-v0.6.0-design.md` (combined) + `specs/2026-05-22-cairn-v1.0.0-design.md`. Each release becomes spec → numbered plans → subagent-driven execution (same workflow as v0.1.0–v0.5.1).

Shipped through **v0.5.1**: workspaces/auth/OAuth/RBAC, multi-workspace, pages + block editor, search, trash, files (local + S3/MinIO) + markdown, inline databases (table/kanban/gallery + formulas/relations/rollups/calendar/timeline), public sharing, realtime collab + presence + comments + @mentions + notifications, public REST API + API keys + webhooks + templates + page version history + backup CLI, and a security suite + CSP/nonce + auth rate-limiting + `SECURITY.md`. Multi-arch (amd64+arm64) images published on `v*.*.*` tags via native per-arch runners.

Two releases remain to 1.0.

---

## v0.6.0 — Content, Sharing, Collaboration, Mobile & Operations (combined)

**Theme:** one large consolidated release closing the remaining Notion-parity gaps and making Cairn deep, shareable, usable everywhere, and operable. Five bands of work (see the combined spec for full detail + decisions):

| Band | Headline features |
|---|---|
| **Content & database** | Reverse (bidirectional) relations · list view + table grouping + richer filters/multi-sort · row hierarchy (sub-items) · new blocks (toggle, columns, simple table, allowlist embed, bookmark/unfurl, math/KaTeX, same-page synced block) · full-page databases · per-column calc footer · table of contents + outline. |
| **Sharing & collaboration** | Per-page share settings (password / expiry / allow-duplication) · published multi-page public site `/s/<workspace-slug>` · comments on databases + files · Yjs-native suggestion/track-changes mode · BYO-SMTP email notifications + prefs · page links + **backlinks** + unlinked mentions + page mentions/embeds · per-database row templates. |
| **Mobile, a11y & i18n** | Responsive/mobile UI · PWA + bounded offline (y-indexeddb) · WCAG 2.1 AA + axe CI gate · keyboard-shortcut registry + ⌘/ sheet · command-palette actions · block conversion + multi-select · hand-rolled i18n (en + RTL proof locale). |
| **Admin, observability & ops** | Workspace admin console (members/roles/invites/settings, transfer-ownership, delete-workspace) · append-only audit log + per-page activity feed · TOTP 2FA + recovery codes · `prom-client` `/metrics` + `pino` JSON logging · per-workspace quotas · scheduled backups + retention + optional S3 · due-date reminders · favorites/recents · column ergonomics · search filters + saved searches · bulk operations · workspace-home setting. |
| **Import / export** | Best-effort Notion + Markdown-folder import · re-importable workspace export · PDF / per-page / per-database export. |

**Migrations:** `0013`–`0022` (contiguous; `ALTER TYPE ADD VALUE` for view_type `+list` runs outside a transaction per the `0011` precedent). **Constraints:** every new editor node/mark stays Yjs-serializable (v0.3.0 collab); every new public/anon/secret/metrics surface continues the v0.5.1 security posture with tests extending that suite; sharing is per-page, never per-block.

**Rough size:** ~23 plans (P1–P23), executed area-by-area in build order: database/editor → sharing/collab → mobile/a11y/i18n → admin/ops/import → combined-smoke + release.

**Risk:** this is a very large single release — execute area-by-area, keep each plan shippable + reviewable, and budget for the raised integration + review burden. (The combined spec's risk section covers the per-feature risks: Yjs-safety of new nodes, reverse-relation write sync, synced blocks, embed/unfurl SSRF/XSS, PWA offline+Yjs, suggestion-mode conflicts, 2FA secret handling, Notion-import fidelity.)

---

## v1.0.0 — Stabilization, API stability, docs & polish

**Theme:** lock it down and call it 1.0. "1.0" for Cairn = **feature-complete** (Notion-parity self-hosted goal met), **stable** (frozen + documented public API, SemVer commitment, tested upgrade path), **documented** (a real docs site), **performant**, and **operable**.

| Feature | Notes / risk |
|---|---|
| **API stability + OpenAPI** | Freeze `/api/v1`; publish an OpenAPI 3.1 spec + a generated typed client; document the compatibility guarantee (breaking changes → `/api/v2` post-1.0). **First expand the surface** — comments/search/file-upload/notifications endpoints + more webhook events (`comment.created`, `member.*`, `page.published/*`) — *before* freezing. **Medium.** |
| **Performance pass** | Virtualized long pages + large database views, lazy heavy blocks, query/index audit, large-doc Yjs tuning, a Lighthouse budget in CI. **Medium.** |
| **Optional AI assist (BYO LLM)** | Summarize / continue-writing / ask-this-page via a bring-your-own OpenAI-compatible endpoint, **opt-in, off by default, self-hostable** (local Ollama/vLLM or any compatible URL); no content leaves the instance unless the operator configures an endpoint (asserted in tests + `SECURITY.md`). **Medium.** |
| **Docs site** | Real documentation: install, configure, API, admin, security. **Low-medium.** |
| **Upgrade/migration guarantees** | Documented + tested migration path; optional checkpoint migration squash. **Low-medium.** |
| **Conditional formatting** | Color database rows/cells by rule (folded here from the former "additional features" set). **Low-medium.** |
| **Final security + dependency review** | Fresh pass over the v0.5.1 suite + a manual external-tool sweep; dependency refresh. **Low.** |
| **Polish + branding** | Onboarding tour + seeded sample content, configurable workspace home, empty states, error pages, theming (custom logo/accent), command-palette completeness. **Low.** |

**Rough size:** ~6 plans.

---

## Out of this roadmap (deferred to post-1.0 / a 2.0 track)

- **Native mobile apps** (iOS/Android) — the PWA covers mobile for 1.0.
- **Cross-page synced blocks** — same-page only in v0.6.0; cross-page needs a shared sub-document model.
- **End-to-end encryption** — revisit for a 2.0 "private" track.
- **Desktop Electron app** — the installable PWA covers desktop.
- **SSO/SAML/SCIM, enterprise directory sync** — OAuth covers 1.0; enterprise auth is a post-1.0 track.
- **WebAuthn / passkeys** — TOTP 2FA covers 1.0.
- **True per-block ACLs** — per-page sharing covers 1.0.
- **Graph view, recurring tasks, comment reactions, guest access** — post-1.0.
- **Semantic / embeddings search** — opt-in generative assist only for 1.0.
- **Horizontal scaling** of the collab service (multi-replica + Redis) — single-instance ceiling stays for homelab scale.
- **Plugin / marketplace system** — post-1.0.

---

## Suggested sequence & rationale

1. **v0.6.0 (combined)** — one large release; execute its ~23 plans **area-by-area** (database/editor first → sharing/collab → mobile/a11y/i18n → admin/ops/import → smoke+release) so each plan stays shippable and reviewable despite the release's size.
2. **v1.0.0 (stabilize)** — freeze the API (after expanding it), performance, docs, opt-in AI, final review; declare SemVer. **Must come last** — it freezes everything before it.

---

## Next step

Brainstorm/confirm the combined v0.6.0 spec, then write its numbered plans and execute subagent-driven (exactly as v0.1.0–v0.5.1), area-by-area.
