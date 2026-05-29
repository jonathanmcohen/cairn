import { redirect } from 'next/navigation';

// Admin section index → first child. Sibling-index precedent: account →
// /settings/account/profile, workspace → /settings/workspace/members, etc.
//
// #61 verification (patches/ux-audit-v0.9.4): the reported 404 used the stale
// path /settings/admin/audit-log; the route was renamed to /settings/admin/audit
// in the v0.8.0 settings-hub restructure (G4 P12). The admin sub-routes are all
// built and requireRole('admin')-gated: audit, api-keys, encryption, mfa,
// upgrade, webhooks (+ webhooks/[id]/deliveries). No stale audit-log references
// remain in src/ or tests/. The build route manifest is the standing proof.
export default function AdminSectionIndex() {
  redirect('/settings/admin/audit');
}
