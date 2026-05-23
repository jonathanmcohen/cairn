# Cairn Roadmap: v0.6.0 → v1.0.0

> Status: **in progress**. Path from the security-hardened **v0.5.1** state to a stable, feature-complete, documented 1.0.0. **v0.6.0 has shipped** (the combined release that consolidated the formerly-separate v0.6 content/db, v0.7 sharing/collab, v0.8 mobile/a11y/i18n, v0.9 admin/ops/import minors). After v0.6.0 the remaining path is **v0.7.0** (extensibility/AI/automation/permissions — see below) then **v1.0.0** (stabilization). Detailed designs: `specs/2026-05-22-cairn-v0.6.0-design.md`, the forthcoming v0.7.0 spec (brainstormed at the start of the v0.7 cycle), and `specs/2026-05-22-cairn-v1.0.0-design.md`. Each release follows spec → numbered plans → subagent-driven execution.

Shipped through **v0.6.0**: everything in v0.5.1 plus reverse relations, list view + filters + grouping + multi-sort, row hierarchy, toggle/columns/table/embed/bookmark/math/synced blocks, TOC + outline + full-page DB + calc footer, per-page share settings + public site `/s/<slug>`, comments on databases + files, Yjs suggestion mode, page links + backlinks + page mentions/embeds + row templates, BYO-SMTP email + digest, mobile/PWA + bounded offline, WCAG 2.1 AA + axe CI gate, keyboard shortcuts + ⌘/ sheet + i18n (en + ar RTL proof), favorites/recents + block convert + multi-select, workspace admin console, audit log + per-page activity, TOTP 2FA + recovery codes, prom-client `/metrics` (token-gated) + pino JSON logger, workspace storage quotas + scheduled backups (`--target s3` + retention), Notion + markdown-folder + workspace-archive import, PDF (browser-print) + per-page/per-database UI export, search filters + saved searches, due-date reminders + `reminders:scan`, bulk trash/restore/move pages, workspace-home landing.

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

## v0.7.0 — Extensibility, permissions, automation & operations depth (single large release)

**Theme:** open Cairn up to agents and ops tooling. Ships as ONE large release (explicitly NOT split into 0.7 + 0.8) — same area-by-area execution pattern as v0.6.0. The headline feature is the MCP server; everything else either supports it (scoped tokens, dev settings, granular ACLs, token-usage audit), extends the existing v0.5 / v0.6 surface (scheduled S3 backup + restore on top of the v0.5 backup CLI; webhook delivery dashboard + HMAC signing on top of the v0.5 webhooks; `/healthz` + open `/metrics` on top of the v0.6 P20 token-gated metrics; rules engine that triggers off existing webhook events), or adds new top-level capabilities (vector search, two-way DB connectors, bulk import/export).

| Feature | Notes / scope |
|---|---|
| **MCP server (HTTP/SSE)** | Token-authed remote MCP endpoint exposing pages/databases/search as tools to LLM agents. **Headline.** Open design points (settle in brainstorm): transport choice (HTTP/SSE is the working assumption for a remote homelab server), write-tool safety/scoping (an agent that can create/delete pages needs explicit per-scope confirmation guards). |
| **Scoped API tokens (PATs)** | Personal access tokens with scopes (e.g. `pages:read`, `pages:write`, `databases:read`, `mcp:*`), per-workspace. Distinct from the existing v0.5 workspace API keys; complements them for per-user agent access. |
| **Developer settings UI** | Mint/revoke PATs, view MCP connection info + scopes, see token-usage timeline (audit log integration). |
| **Bulk import/export** | Markdown + Notion-export import + full-workspace export. Builds on the v0.6 P21 import/export (which already covers Notion-ZIP + markdown-folder + workspace-archive); this delta is the UI flow + larger-scale batching. |
| **Scheduled S3 backup + restore** | Automate the v0.5 `backup --target s3` (already wired in v0.6 P21 CLI) on a schedule, and add the missing **restore** path on top of the S3/MinIO backend. Delta on top of v0.5/v0.6 — do not rebuild the dump/upload that already exists. |
| **Granular page permissions** | Per-page/per-user ACLs (view / comment / edit), **inherited down the page tree**. Open design point (settle in brainstorm): how this interacts with the v0.2 / v0.6 per-page public-sharing model (public link is a separate axis from member ACL; precedence rules need to be explicit). |
| **Audit log + token-usage log** | Per-workspace activity trail extending v0.6 P18 audit (which already covers 16 sensitive actions) with **API + MCP token access** events. |
| **Automation / rules engine** | Triggers on the v0.5 webhook events → actions (notify, set property, create page). The trigger surface is already there (webhooks fire); this ships the rule-evaluation + action-dispatch layer + UI. |
| **Vector / semantic search** | `pgvector` for storage (parallels the v0.5.1 FTS+trigram path). **Open design point (DEFERRED for the brainstorm):** embedding-model hosting — external API (OpenAI-compatible BYO endpoint) vs. local model (Ollama/onnxruntime); the choice rides on the homelab-scale constraint and the 1.0 AI-assist BYO-LLM decision. |
| **Health + Prometheus metrics endpoint** | `/healthz` (already present) and an **open** `/metrics` endpoint. **Open design point:** how this interacts with the v0.6 P20 token-gated `/metrics` (most likely: P20's token-gated `/metrics` stays for sensitive Cairn-specific series; `/healthz` is the always-open liveness probe; an open `/metrics` only makes sense if it exposes a curated subset — settle in brainstorm). |
| **Webhook delivery dashboard** | Delivery log, automatic retries (the v0.5 dispatcher already retries — this adds the UI + admin view), HMAC signing for the v0.5 webhooks (signing already exists per v0.5 P2; this surface makes it visible/configurable). |
| **Two-way database connectors** | Live-sync a Cairn database ↔ Google Sheets / Airtable / CSV. The most ambitious item in scope — needs a sync engine (poll or push), conflict handling, and per-connector auth (OAuth for Sheets/Airtable, file watch for CSV). |

**Rough size:** ~20+ numbered plans (~10 of which are MCP-server + PATs + dev-settings + ACLs + audit-token-usage; ~10 across the remaining seven items). Execute area-by-area: tokens/ACLs/MCP first (the headline + everything that depends on it) → audit/automation/webhook-dashboard (builds on shipped infra) → search/connectors/bulk-import/export/scheduled-backup-restore.

**Open design points (brainstorm-time):**
- MCP transport (HTTP/SSE assumed; revisit if a stdio-over-tunnel model is materially simpler for a homelab).
- MCP write-tool safety / scoping / confirmation guards — an agent that can create/delete pages needs explicit per-scope opt-in, not blanket access.
- Embedding-model hosting decision (external BYO vs. local).
- Granular page permissions × existing public-sharing model — explicit precedence rules.

**Constraints:** every new auth surface continues the v0.5.1 / v0.6 security posture (no token leak into responses, audit, or logs — extend the secret-leak suite); every new event fans through the existing P18 audit + P20 metrics + P11 email notification paths rather than parallel infrastructure.

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

1. **v0.6.0 (combined) — SHIPPED.** Executed its 23 plans area-by-area; image published at `ghcr.io/jonathanmcohen/cairn:0.6.0`.
2. **v0.7.0 (extensibility/automation)** — single large release; ~20+ plans area-by-area (tokens/ACLs/MCP → audit/automation/webhook-dashboard → search/connectors/bulk-import-export/scheduled-backup-restore). Headline = MCP server.
3. **v1.0.0 (stabilize)** — freeze the API (after expanding it), performance, docs, opt-in AI, final review; declare SemVer. **Must come last** — it freezes everything before it.

---

## Next step

Brainstorm/confirm the v0.7.0 spec — settle the open design points (MCP transport, MCP write-tool safety/scoping, embedding-model hosting, granular page permissions × public-sharing model) — then write its numbered plans and execute subagent-driven, area-by-area, exactly as v0.1.0–v0.6.0.
