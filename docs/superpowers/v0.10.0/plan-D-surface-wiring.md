# Plan D — surface wiring (backend exists, UI missing)

> **HOLD until GO.**

Six items the re-audit proved live server-side with no (or unreachable) UI.
Every spec here drives the real browser surface — handler-import tests
explicitly do not count toward the gate (the F1 lesson).

## D1 — SIEM forwarder "Send test" (seed 8) — Backend-exists-no-UI

**Exists:** `POST /api/admin/siem/[id]/test` (`route.ts:18-85`) — admin-gated,
workspace-scoped, synthetic `siem.test_event` envelope, real send, unit-tested
(`tests/api/admin/siem.test.ts:425-470`). **Missing:** the forwarders view
(`settings/admin/siem/forwarders-view.tsx:33-64`) renders rows with no
test/edit/delete actions.

**Build:** per-row "Send test" button → POST → inline ok/fail result.

**Failure modes verified:**
- Sender failure returns **HTTP 200 `{ok:false,error}`** while auth/404 are
  non-2xx — the button must key off the body, not `res.ok` (audit's exact
  trap; spec covers both shapes).
- s3-kind forwarder → 400 "no sender wired for kind=s3" rendered as a clear
  message, not a generic network error.
- Error strings surfaced verbatim from the target (`route.ts:73` does not
  scrub) → UI truncates/labels them as remote output; spec asserts a
  secret-looking target error is not auto-expanded.
- Synthetic event never lands in `siem_delivery_log` (spec asserts count
  unchanged after a test fire).

## D2 — Audit log CSV export (seed 9) — Net-new (contained)

**Exists:** nothing — no button, no `format=csv` branch, no serializer
(`audit-viewer.tsx` has only Load-more; `api/admin/audit/route.ts:9-18` Query
schema has no format param). The "no-op stub" memory was wrong only in that
there is no stub at all.

**Build:** RFC-4180 CSV serializer over the enriched rows, a streaming
`/api/admin/audit/export` honoring the current filters, an Export button in
the viewer, i18n.

**Failure modes verified:**
- CSV/formula injection: a row whose targetTitle is `=cmd|calc` exports with
  the cell prefixed/escaped (`'` guard), asserted byte-level.
- RFC-4180: commas/quotes/newlines in jsonb metadata stay in one logical row.
- 250 seeded rows → export contains all 250 (not one 100-cap page).
- Tenant isolation: workspace-A admin's export contains zero workspace-B rows.

## D3 — OAuth registered-clients registry (seed 12) — Backend-exists-no-UI

**Exists:** `oauth_clients` table (migration 0069) + unauthenticated RFC 7591
`POST /api/oauth/register`. The v0.9.16 "OAuth connections" list shows
**`oauth_tokens` grants for the signed-in user** — there is no admin surface
to LIST or DELETE registered client apps, no GET/DELETE route at all.

**Build:** admin route family (GET list incl. created_at/redirect_uris/
confidential flag + grant counts; DELETE client → cascades revocation of its
tokens), an Admin → OAuth clients page, audit events.

**Failure modes verified:**
- Registration flood: after N junk registrations an admin can see and purge
  them (the DoS/table-bloat trap; spec registers 3, deletes 1, asserts list).
- Revoking a grant does NOT deregister the client (existing behavior) — the
  page copy + spec distinguish grants vs clients (the operator-confusion trap).
- Deleting a client revokes ALL its tokens across users (spec: two users
  authorize, admin deletes client, both bearers → 401).
- Compromised confidential client (`cairn_ocs_` leak) is deletable in-product.

## D4 — Health/readiness admin panel (seed 14) — Backend-exists-no-UI

**Exists:** `GET /api/health` (`route.ts:6-19`, always-200 body-only status)
and `GET /healthz` (`app/healthz/route.ts:24-39`, liveness, 503 on db-down,
uptime/version). **Missing:** any admin surface; any readiness distinction.

**Build:** Admin → Health panel reading `/healthz` (db state, version, uptime,
collab-bridge configured — fold A4's signal in here so it's visible on a page
admins actually visit), plus either a real `/readyz` (migrations-applied +
collab reachable) or documenting `/healthz` as the readiness probe in
docs/operations.md.

**Failure modes verified:**
- `/api/health` returns 200 with `db:'down'` — panel must read the BODY field
  (the LB-keyed-on-status-code trap; documented + asserted).
- Panel renders degraded state distinctly (spec stubs a db-down healthz).
- Uptime is per-replica — labeled as such (multi-replica honesty).

## D5 — Archived-pages browse view (seed 18) — UI-incomplete

**Exists:** `archived` page status (distinct from trash), legal transitions
published→archived→draft, audit rows, API. **Missing:** the `/archived` view —
`tree.ts:74`'s comment promises it but it was never built, so an archived page
is hidden from sidebar AND search: **effectively un-findable** (only a direct
URL recovers it). Closest to a real bug in this plan.

**Build:** an Archived browse view (sidebar utility entry, like Trash) listing
archived pages with un-archive; include archived pages in search behind an
explicit filter (`status:archived` operator already parses — verify).

**Failure modes verified:**
- Archive a page → it appears in the Archived view and can be un-archived
  back to draft (RED today — nothing lists it; the falsifiable core).
- Archiving a published page silently kills its public `/s/<slug>` link —
  surface a warning in the status picker (spec asserts the warning).
- Tenant + role: viewers see the archived list read-only; cross-workspace 404.

## D6 — Storage usage indicator + quota admin (seed 19) — Backend-exists-no-UI

**Exists & enforced:** `workspace_quotas` (storageBytesLimit/Used),
`checkStorageQuota` rejects uploads over limit, transactional
increment/decrement, `reconcileQuota` CLI. **Missing:** any read API, any
usage UI, any in-product way to set a limit — users hit `QuotaExceededError`
blind.

**Build:** GET usage route, a usage bar (X of Y used / unlimited) on Workspace
settings + Admin, admin control to set/clear the limit, "Reconcile now" button
wrapping `reconcileQuota`.

**Failure modes verified:**
- Near-limit workspace shows the meter and the upload error names the
  remaining space (spec fills to ~limit and asserts copy).
- Counter drift: delete files out-of-band → Reconcile corrects the meter
  (spec compares against `sum(files.size)`).
- Limit change takes effect on the next upload without restart.
- Editor/viewer can read usage, only admin/owner can change the limit.
