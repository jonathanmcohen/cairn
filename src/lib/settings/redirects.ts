/**
 * Maps every legacy settings path to its new home under the sectioned hub.
 * Returns `null` for paths that are already in the new shape, for non-settings
 * paths, and for paths that don't need to move (e.g. /settings/admin/audit
 * stays under admin).
 *
 * The proxy applies the result via NextResponse.redirect(308, …) on every
 * request — keeps bookmarks + palette-link references working for v0.8.
 *
 * Single source of truth: the test in tests/lib/settings/redirects.test.ts
 * enumerates every old path from the v0.7 tree; if a future release adds a
 * new legacy entry, both sides update together.
 */

const PREFIX_REDIRECTS: Array<[from: string, to: string]> = [
  // Workspace section: admin → workspace.
  ['/settings/admin/invites', '/settings/workspace/invites'],
  ['/settings/admin/settings', '/settings/workspace/general'],
  ['/settings/admin/danger', '/settings/workspace/danger'],
  // The bare /settings/admin landing was the members table — move to workspace.
  // (Note: /settings/admin/audit + /settings/admin/webhooks stay under admin.)

  // Developer section: surface developer-y leaves under one parent.
  ['/settings/api-keys', '/settings/developer/api-keys'],
  ['/settings/automation', '/settings/developer/automation'],
  ['/settings/connectors', '/settings/developer/connectors'],
  ['/settings/import', '/settings/developer/import'],
  ['/settings/export', '/settings/developer/export'],

  // Webhooks live under admin in the new layout.
  ['/settings/webhooks', '/settings/admin/webhooks'],
];

const EXACT_REDIRECTS: Record<string, string> = {
  '/settings': '/settings/account/profile',
  '/settings/profile': '/settings/account/profile',
  // v0.9.18 item #5 — /settings/admin no longer redirects: it has its own
  // landing page (src/app/(app)/settings/admin/page.tsx). The old entry sent
  // it to /settings/workspace/members (v0.8 restructure, when the bare admin
  // landing WAS the members table), which silently shadowed the page-level
  // redirect and made /settings/admin itself unreachable.
  '/settings/developer': '/settings/developer/api-keys',
};

export function resolveSettingsRedirect(pathname: string): string | null {
  // Out-of-scope guard — only handle /settings/*.
  if (!pathname.startsWith('/settings')) return null;

  // Exact-match first.
  if (Object.hasOwn(EXACT_REDIRECTS, pathname)) {
    return EXACT_REDIRECTS[pathname]!;
  }

  // Prefix-replace, longest-first so /settings/admin/invites beats /settings/admin.
  const sorted = [...PREFIX_REDIRECTS].sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of sorted) {
    if (pathname === from) return to;
    if (pathname.startsWith(`${from}/`)) {
      const suffix = pathname.slice(from.length); // includes leading slash
      return `${to}${suffix}`;
    }
  }

  return null;
}
