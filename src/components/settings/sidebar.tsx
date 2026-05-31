'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

type SubPage = { id: string; label: string; href: Route };
type Section = {
  id: string;
  label: string;
  href: Route;
  children?: SubPage[];
};

const SECTIONS: Section[] = [
  { id: 'account', label: 'Account', href: '/settings/account' as Route },
  {
    id: 'workspace',
    label: 'Workspace',
    href: '/settings/workspace' as Route,
    children: [
      { id: 'workspace-general', label: 'General', href: '/settings/workspace/general' as Route },
      { id: 'workspace-members', label: 'Members', href: '/settings/workspace/members' as Route },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    href: '/settings/admin' as Route,
    children: [
      { id: 'admin-audit', label: 'Audit log', href: '/settings/admin/audit' as Route },
      // User management lives under Workspace > Members; surface it from Admin
      // too so admins find member role/deactivate controls without hunting.
      { id: 'admin-members', label: 'Members', href: '/settings/workspace/members' as Route },
      { id: 'admin-siem', label: 'SIEM forwarders', href: '/settings/admin/siem' as Route },
    ],
  },
  {
    id: 'developer',
    label: 'Developer',
    href: '/settings/developer' as Route,
    children: [
      {
        id: 'developer-connectors',
        label: 'Connectors',
        href: '/settings/developer/connectors' as Route,
      },
    ],
  },
  { id: 'notifications', label: 'Notifications', href: '/settings/notifications' as Route },
  { id: 'security', label: 'Security', href: '/settings/security' as Route },
];

export function SettingsSidebar({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname() ?? '';
  const containerRef = useRef<HTMLElement>(null);
  // Role-gate the Admin entry: /settings/admin redirects into
  // requireRole('admin')-gated pages, so showing it to viewers/editors
  // surfaces a tab that 403s. Mirror the server gate (see #60/#61).
  const sections = SECTIONS.filter((s) => s.id !== 'admin' || isAdmin);

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
      {sections.map((s) => {
        const active = pathname === s.href || pathname.startsWith(`${s.href}/`);
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
