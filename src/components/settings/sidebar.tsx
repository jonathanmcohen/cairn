'use client';

import {
  ArrowLeft,
  Bell,
  Building2,
  ChevronDown,
  ChevronRight,
  Code2,
  KeyRound,
  type LucideIcon,
  Search,
  ShieldCheck,
  User,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '@/lib/i18n/provider';

type SubPage = { id: string; label: string; href: Route; group?: string };
/** Collapsible sub-group header inside a section (v0.10.2 P10 — Admin only). */
type SubGroup = { id: string; label: string };
type Section = {
  id: string;
  label: string;
  href: Route;
  /** v0.10.2 P11 — 16px leading icon on the top-level link (aria-hidden). */
  icon: LucideIcon;
  children?: SubPage[];
  /** When present, children render under collapsible group headers (by `group`). */
  groups?: SubGroup[];
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
    // v0.10.2 P10 — the Admin section grew to 16 flat entries; they now render
    // under six collapsible sub-groups. `group` keys an entry into a SubGroup
    // below; array order within a group is the render order.
    const adminChildren: SubPage[] = [
      // --- Identity ---
      // Dedicated workspace user-management surface (audit item A). Replaces
      // the old cross-link into Workspace > Members.
      {
        id: 'admin-members',
        label: t('settings.nav.admin.members'),
        href: '/settings/admin/users' as Route,
        group: 'identity',
      },
      // SSO console now lives inside the settings hub (audit item B).
      {
        id: 'admin-sso',
        label: t('settings.nav.admin.sso'),
        href: '/settings/admin/sso' as Route,
        group: 'identity',
      },
      {
        id: 'admin-mfa',
        label: t('settings.nav.admin.mfa'),
        href: '/settings/admin/mfa' as Route,
        group: 'identity',
      },
      // --- Audit & Compliance ---
      {
        id: 'admin-audit',
        label: t('settings.nav.admin.audit'),
        href: '/settings/admin/audit' as Route,
        group: 'audit',
      },
      {
        id: 'admin-siem',
        label: t('settings.nav.admin.siem'),
        href: '/settings/admin/siem' as Route,
        group: 'audit',
      },
      // --- Integrations ---
      {
        id: 'admin-webhooks',
        label: t('settings.nav.admin.webhooks'),
        href: '/settings/admin/webhooks' as Route,
        group: 'integrations',
      },
      // Chat-bridge console — canonical home inside the hub (v0.9.9 C5 #186).
      {
        id: 'admin-chat-bridge',
        label: t('settings.nav.admin.chatBridge'),
        href: '/settings/admin/chat-bridge' as Route,
        group: 'integrations',
      },
      {
        id: 'admin-federated',
        label: t('settings.nav.admin.federated'),
        href: '/settings/admin/federated' as Route,
        group: 'integrations',
      },
      // Instance OAuth client-application registry (v0.10.0 D3).
      {
        id: 'admin-oauth-clients',
        label: t('settings.nav.admin.oauthClients'),
        href: '/settings/admin/oauth-clients' as Route,
        group: 'integrations',
      },
      // --- Quotas ---
      {
        id: 'admin-api-keys',
        label: t('settings.nav.admin.apiKeys'),
        href: '/settings/admin/api-keys' as Route,
        group: 'quotas',
      },
      // Workspace storage usage + quota admin (v0.10.0 D6).
      {
        id: 'admin-storage',
        label: t('settings.nav.admin.storage'),
        href: '/settings/admin/storage' as Route,
        group: 'quotas',
      },
      // --- Operations ---
      // Instance email (SMTP) config — DB overrides SMTP_* env (v0.10.3 CFG-1).
      {
        id: 'admin-email',
        label: t('settings.nav.admin.email'),
        href: '/settings/admin/email' as Route,
        group: 'operations',
      },
      // Instance object-storage (S3) config — DB overrides S3_*/FILE_BACKEND
      // env (v0.10.3 CFG-2). Distinct from the workspace storage-QUOTA page
      // (admin-storage) above.
      {
        id: 'admin-object-storage',
        label: t('settings.nav.admin.objectStorage'),
        href: '/settings/admin/object-storage' as Route,
        group: 'operations',
      },
      // Cron-driven CLI job schedules (v0.10.3 CFG-3).
      {
        id: 'admin-schedules',
        label: t('settings.nav.admin.schedules'),
        href: '/settings/admin/schedules' as Route,
        group: 'operations',
      },
      // Instance backup snapshots (v0.10.0 C1).
      {
        id: 'admin-backups',
        label: t('settings.nav.admin.backups'),
        href: '/settings/admin/backups' as Route,
        group: 'operations',
      },
      // Instance health/readiness panel (v0.10.0 D4).
      {
        id: 'admin-health',
        label: t('settings.nav.admin.health'),
        href: '/settings/admin/health' as Route,
        group: 'operations',
      },
      // Read-only schema-migration status panel (v0.10.0 D7).
      {
        id: 'admin-migrations',
        label: t('settings.nav.admin.migrations'),
        href: '/settings/admin/migrations' as Route,
        group: 'operations',
      },
      // --- Billing ---
      {
        id: 'admin-upgrade',
        label: t('settings.nav.admin.upgrade'),
        href: '/settings/admin/upgrade' as Route,
        group: 'billing',
      },
    ];
    // E2E toggle is gated behind the build-time flag; only surface it when on.
    if (e2eEnabled) {
      adminChildren.push({
        id: 'admin-encryption',
        label: t('settings.nav.admin.encryption'),
        href: '/settings/admin/encryption' as Route,
        group: 'identity',
      });
    }
    // Collapsible Admin sub-group headers, in render order (v0.10.2 P10).
    const adminGroups: SubGroup[] = [
      { id: 'identity', label: t('settings.nav.admin.group.identity') },
      { id: 'audit', label: t('settings.nav.admin.group.audit') },
      { id: 'integrations', label: t('settings.nav.admin.group.integrations') },
      { id: 'quotas', label: t('settings.nav.admin.group.quotas') },
      { id: 'operations', label: t('settings.nav.admin.group.operations') },
      { id: 'billing', label: t('settings.nav.admin.group.billing') },
    ];

    return [
      // G17 (#164) — full-page search lives outside the settings hub at /search;
      // surface it here so the page is reachable from the nav. Static label,
      // consistent with the route living outside /settings.
      { id: 'search', label: 'Search', href: '/search' as Route, icon: Search },
      {
        id: 'account',
        label: t('settings.nav.account'),
        icon: User,
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
        icon: Building2,
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
            id: 'workspace-slash-commands',
            label: t('settings.nav.workspace.slashCommands'),
            href: '/settings/workspace/slash-commands' as Route,
          },
          {
            id: 'workspace-trash',
            label: t('settings.nav.workspace.trash'),
            href: '/settings/workspace/trash' as Route,
          },
          {
            id: 'workspace-flashcards',
            label: t('settings.nav.workspace.flashcards'),
            href: '/settings/workspace/flashcards' as Route,
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
        icon: ShieldCheck,
        // Parent click navigates straight to the first real leaf. The bare
        // /settings/admin route renders its own landing page (v0.9.18 #5) and
        // is served no-store (v0.9.19 A5) so a stale cached 308 can't shadow
        // it; the nav targets the leaf directly regardless.
        href: '/settings/admin/audit' as Route,
        children: adminChildren,
        groups: adminGroups,
      },
      {
        id: 'developer',
        label: t('settings.nav.developer'),
        icon: Code2,
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
          // v0.10.0 H4c — the import page has existed since v0.7 G5 P15 but
          // never had a nav entry (export did). Same gating as export: the
          // entry is visible to every member here, and the page itself
          // requires admin (both pages call requireRole('admin')).
          {
            id: 'developer-import',
            label: t('settings.nav.developer.import'),
            href: '/settings/developer/import' as Route,
          },
        ],
      },
      {
        id: 'notifications',
        label: t('settings.nav.notifications'),
        icon: Bell,
        href: '/settings/notifications' as Route,
      },
      {
        id: 'security',
        label: t('settings.nav.security'),
        icon: KeyRound,
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

  // v0.10.2 P10 — per-mount expand/collapse overrides for the Admin sub-groups
  // (no persistence). The default state is derived from the route: the group
  // containing the ACTIVE admin page is expanded (deep-link auto-expand), the
  // rest start collapsed. A user toggle wins over the derived default.
  const [groupOverrides, setGroupOverrides] = useState<Record<string, boolean>>({});
  const adminChildren = sections.find((s) => s.id === 'admin')?.children;
  const activeAdminGroup = adminChildren?.find(
    (c) => pathname === c.href || pathname.startsWith(`${c.href}/`),
  )?.group;
  const isGroupExpanded = (id: string) => groupOverrides[id] ?? id === activeAdminGroup;

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
      {/* The E5 settings refactor unmounts the workspace sidebar on
          /settings/*, which left these pages with NO route back to the app —
          every nav target here stays inside /settings. */}
      <Link
        href="/"
        data-settings-nav
        data-testid="settings-back-to-workspace"
        className="mb-2 flex min-h-11 items-center gap-2 rounded px-3 py-2 text-sm text-muted-foreground outline-none hover:bg-accent/50 hover:text-foreground focus:ring-2 focus:ring-ring"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4 shrink-0" />
        {t('settings.nav.backToWorkspace')}
      </Link>
      {visible.map((s) => {
        const active =
          s.id === 'admin'
            ? pathname.startsWith('/settings/admin')
            : pathname === s.href || pathname.startsWith(`${s.href}/`);
        const renderChild = (c: SubPage) => {
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
        };
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
              <s.icon aria-hidden="true" className="mr-2 h-4 w-4 shrink-0" />
              {s.label}
            </Link>
            {active && s.children && s.groups ? (
              // v0.10.2 P10 — collapsible sub-groups (Admin). A collapsed
              // group UNMOUNTS its links so both the arrow-key ring
              // (a[data-settings-nav] querySelectorAll) and the tab order
              // skip them. Header buttons are tab-reachable but deliberately
              // NOT part of the arrow ring.
              <div className="mt-1 ml-3 space-y-1 border-l pl-2">
                {s.groups.map((g) => {
                  const groupChildren = s.children?.filter((c) => c.group === g.id) ?? [];
                  if (groupChildren.length === 0) return null;
                  const expanded = isGroupExpanded(g.id);
                  const panelId = `settings-admin-group-panel-${g.id}`;
                  return (
                    <div key={g.id}>
                      <button
                        type="button"
                        data-testid={`admin-group-${g.id}`}
                        aria-expanded={expanded}
                        // Collapsed → the panel is unmounted; axe allows the
                        // dangling idref while aria-expanded="false".
                        aria-controls={panelId}
                        onClick={() =>
                          setGroupOverrides((prev) => ({ ...prev, [g.id]: !expanded }))
                        }
                        className="flex min-h-11 w-full items-center gap-1.5 rounded px-2 py-2 text-left font-medium text-muted-foreground text-xs uppercase tracking-wide outline-none hover:bg-accent/50 hover:text-foreground focus:ring-2 focus:ring-ring"
                      >
                        {expanded ? (
                          <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                        ) : (
                          <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                        )}
                        {g.label}
                      </button>
                      {expanded ? (
                        <div id={panelId} className="space-y-1">
                          {groupChildren.map(renderChild)}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : active && s.children ? (
              <div className="mt-1 ml-3 space-y-1 border-l pl-2">{s.children.map(renderChild)}</div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
