'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * v0.10.0 Plan E E5 (polish-audit #19) — suppress the workspace navigation
 * chrome (the desktop `<Sidebar>` aside + the mobile `<SidebarDrawer>`
 * hamburger bar/drawer) on /settings/* routes, where `<SettingsSidebar>` is
 * the sole left nav. Without this gate both left navs render stacked under
 * /settings.
 *
 * Mechanism: the (app) server layout passes the (server-rendered) sidebar
 * subtree as `children`; this client gate only decides whether to mount it.
 * - Hard load of /settings/...: `usePathname()` resolves to the request path
 *   during the SSR pass of client components, so the workspace nav is never
 *   emitted into the HTML — no two-nav flash before hydration.
 * - Soft nav: the (app) layout (and the already-serialized children prop) is
 *   reused by the App Router, but the gate re-renders on every pathname
 *   change, so navigating settings → workspace restores the sidebar without a
 *   server round-trip. (The layout's own `x-pathname` header read would go
 *   stale here — layouts do not re-render on soft navigation.)
 *
 * Focus/reader mode (O2-O4) is untouched: those hide the sidebar via the
 * `cairn-focus-mode` root class + CSS on non-settings routes; here the nav is
 * unmounted entirely. The O3 hot-edge only mounts inside `<PageModeShell>` on
 * page-detail routes, so settings never shows an orphaned reveal affordance.
 */
export function WorkspaceNavGate({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '';
  // Segment-exact: only the settings hub itself and its descendants match, so
  // a future sibling route that merely shares the string prefix stays gated in.
  const onSettings = pathname === '/settings' || pathname.startsWith('/settings/');
  if (onSettings) return null;
  return <>{children}</>;
}
