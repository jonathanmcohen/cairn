'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef } from 'react';
import { useT } from '@/lib/i18n/provider';

type SubPage = { id: string; label: string; href: Route };
type Section = {
  id: string;
  label: string;
  href: Route;
  children?: SubPage[];
};

export function SettingsSidebar({
  isAdmin = false,
  e2eEnabled = false,
}: {
  isAdmin?: boolean;
  e2eEnabled?: boolean;
}) {
  const t = useT();
  const pathname = usePathname() ?? '';
  const containerRef = useRef<HTMLElement>(null);

  // Build the section model from the i18n catalog. The orphaned settings pages
  // (#161 / G14) are surfaced here as children. SSO lives inside the hub at
  // /settings/admin/sso; v0.9.9 C5 (#186) relocated chat-bridge INTO the hub at
  // /settings/admin/chat-bridge (a single Admin entry — the old duplicate
  // Developer entries are gone; the Developer connectors panel still cross-links
  // the chat-bridge form as a rail).
  const sections = useMemo<Section[]>(() => {
    const adminChildren: SubPage[] = [
      {
        id: 'admin-audit',
        label: t('settings.nav.admin.audit'),
        href: '/settings/admin/audit' as Route,
      },
      // Dedicated workspace user-management surface (audit item A). Replaces
      // the old cross-link into Workspace > Members.
      {
        id: 'admin-members',
        label: t('settings.nav.admin.members'),
        href: '/settings/admin/users' as Route,
      },
      {
        id: 'admin-siem',
        label: t('settings.nav.admin.siem'),
        href: '/settings/admin/siem' as Route,
      },
      {
        id: 'admin-federated',
        label: t('settings.nav.admin.federated'),
        href: '/settings/admin/federated' as Route,
      },
      {
        id: 'admin-webhooks',
        label: t('settings.nav.admin.webhooks'),
        href: '/settings/admin/webhooks' as Route,
      },
      {
        id: 'admin-mfa',
        label: t('settings.nav.admin.mfa'),
        href: '/settings/admin/mfa' as Route,
      },
      {
        id: 'admin-upgrade',
        label: t('settings.nav.admin.upgrade'),
        href: '/settings/admin/upgrade' as Route,
      },
      {
        id: 'admin-api-keys',
        label: t('settings.nav.admin.apiKeys'),
        href: '/settings/admin/api-keys' as Route,
      },
      // SSO console now lives inside the settings hub (audit item B).
      { id: 'admin-sso', label: t('settings.nav.admin.sso'), href: '/settings/admin/sso' as Route },
      // Chat-bridge console — canonical home inside the hub (v0.9.9 C5 #186).
      {
        id: 'admin-chat-bridge',
        label: t('settings.nav.admin.chatBridge'),
        href: '/settings/admin/chat-bridge' as Route,
      },
      // Instance backup snapshots (v0.10.0 C1).
      {
        id: 'admin-backups',
        label: t('settings.nav.admin.backups'),
        href: '/settings/admin/backups' as Route,
      },
      // Instance OAuth client-application registry (v0.10.0 D3).
      {
        id: 'admin-oauth-clients',
        label: t('settings.nav.admin.oauthClients'),
        href: '/settings/admin/oauth-clients' as Route,
      },
      // Instance health/readiness panel (v0.10.0 D4).
      {
        id: 'admin-health',
        label: t('settings.nav.admin.health'),
        href: '/settings/admin/health' as Route,
      },
      // Workspace storage usage + quota admin (v0.10.0 D6).
      {
        id: 'admin-storage',
        label: t('settings.nav.admin.storage'),
        href: '/settings/admin/storage' as Route,
      },
    ];
    // E2E toggle is gated behind the build-time flag; only surface it when on.
    if (e2eEnabled) {
      adminChildren.push({
        id: 'admin-encryption',
        label: t('settings.nav.admin.encryption'),
        href: '/settings/admin/encryption' as Route,
      });
    }

    return [
      // G17 (#164) — full-page search lives outside the settings hub at /search;
      // surface it here so the page is reachable from the nav. Static label,
      // consistent with the route living outside /settings.
      { id: 'search', label: 'Search', href: '/search' as Route },
      {
        id: 'account',
        label: t('settings.nav.account'),
        href: '/settings/account' as Route,
        children: [
          {
            id: 'account-theme',
            label: t('settings.nav.account.theme'),
            href: '/settings/account/theme' as Route,
          },
        ],
      },
      {
        id: 'workspace',
        label: t('settings.nav.workspace'),
        href: '/settings/workspace' as Route,
        children: [
          {
            id: 'workspace-general',
            label: t('settings.nav.workspace.general'),
            href: '/settings/workspace/general' as Route,
          },
          {
            id: 'workspace-members',
            label: t('settings.nav.workspace.members'),
            href: '/settings/workspace/members' as Route,
          },
          {
            id: 'workspace-pinned',
            label: t('settings.nav.workspace.pinnedPages'),
            href: '/settings/workspace/pinned-pages' as Route,
          },
          {
            id: 'workspace-trash',
            label: t('settings.nav.workspace.trash'),
            href: '/settings/workspace/trash' as Route,
          },
          {
            id: 'workspace-export-static',
            label: t('settings.nav.workspace.exportStatic'),
            href: '/settings/workspace/export-static-site' as Route,
          },
        ],
      },
      {
        id: 'admin',
        label: t('settings.nav.admin'),
        // Parent click navigates straight to the first real leaf. The bare
        // /settings/admin route renders its own landing page (v0.9.18 #5) and
        // is served no-store (v0.9.19 A5) so a stale cached 308 can't shadow
        // it; the nav targets the leaf directly regardless.
        href: '/settings/admin/audit' as Route,
        children: adminChildren,
      },
      {
        id: 'developer',
        label: t('settings.nav.developer'),
        href: '/settings/developer' as Route,
        children: [
          {
            id: 'developer-connectors',
            label: t('settings.nav.developer.connectors'),
            href: '/settings/developer/connectors' as Route,
          },
          // v0.9.9 C5 (#186) — the duplicate Developer chat-bridge entries were
          // removed; chat-bridge now has a single canonical Admin entry inside
          // the hub. The Developer connectors panel still surfaces the
          // chat-bridge form as a rail, so the feature is not lost here.
          {
            id: 'developer-automation',
            label: t('settings.nav.developer.automation'),
            href: '/settings/developer/automation' as Route,
          },
          {
            id: 'developer-tokens',
            label: t('settings.nav.developer.tokens'),
            href: '/settings/developer/tokens' as Route,
          },
          {
            id: 'developer-export',
            label: t('settings.nav.developer.export'),
            href: '/settings/developer/export' as Route,
          },
        ],
      },
      {
        id: 'notifications',
        label: t('settings.nav.notifications'),
        href: '/settings/notifications' as Route,
      },
      {
        id: 'security',
        label: t('settings.nav.security'),
        href: '/settings/security' as Route,
        children: [
          {
            id: 'security-encryption',
            label: t('settings.nav.security.encryption'),
            href: '/settings/security/encryption' as Route,
          },
        ],
      },
    ];
  }, [t, e2eEnabled]);

  // Role-gate the Admin entry: /settings/admin pages 403 for non-admins.
  const visible = sections.filter((s) => s.id !== 'admin' || isAdmin);

  // Arrow-up/down navigation. Listens on the nav container; wraps at edges.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const links = Array.from(root!.querySelectorAll<HTMLAnchorElement>('a[data-settings-nav]'));
      if (links.length === 0) return;
      const active = document.activeElement;
      const idx = links.findIndex((el) => el === active);
      if (idx === -1) return;
      e.preventDefault();
      const next =
        e.key === 'ArrowDown' ? (idx + 1) % links.length : (idx - 1 + links.length) % links.length;
      links[next]?.focus();
    }
    root.addEventListener('keydown', onKey);
    return () => root.removeEventListener('keydown', onKey);
  }, []);

  return (
    <nav
      ref={containerRef}
      aria-label="Settings sections"
      className="sticky top-4 w-48 shrink-0 space-y-1"
    >
      {visible.map((s) => {
        const active =
          s.id === 'admin'
            ? pathname.startsWith('/settings/admin')
            : pathname === s.href || pathname.startsWith(`${s.href}/`);
        return (
          <div key={s.id}>
            <Link
              href={s.href}
              data-settings-nav
              // Only the exact match owns the current-page semantic; when you're
              // on a sub-page, the child below carries aria-current="page" so the
              // nav never has two current-page targets (a11y).
              aria-current={pathname === s.href ? 'page' : undefined}
              className={`flex min-h-11 items-center rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring ${
                active ? 'bg-accent font-medium text-accent-foreground' : 'hover:bg-accent/50'
              }`}
            >
              {s.label}
            </Link>
            {active && s.children ? (
              <div className="mt-1 ml-3 space-y-1 border-l pl-2">
                {s.children.map((c) => {
                  const childActive = pathname === c.href || pathname.startsWith(`${c.href}/`);
                  return (
                    <Link
                      key={c.id}
                      href={c.href}
                      data-settings-nav
                      aria-current={childActive ? 'page' : undefined}
                      className={`flex min-h-11 items-center rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring ${
                        childActive
                          ? 'bg-accent font-medium text-accent-foreground'
                          : 'text-muted-foreground hover:bg-accent/50'
                      }`}
                    >
                      {c.label}
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
