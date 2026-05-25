'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

type Section = {
  id: string;
  label: string;
  href: Route;
};

const SECTIONS: Section[] = [
  { id: 'account', label: 'Account', href: '/settings/account' as Route },
  { id: 'workspace', label: 'Workspace', href: '/settings/workspace' as Route },
  { id: 'admin', label: 'Admin', href: '/settings/admin' as Route },
  { id: 'developer', label: 'Developer', href: '/settings/developer' as Route },
  { id: 'notifications', label: 'Notifications', href: '/settings/notifications' as Route },
  { id: 'security', label: 'Security', href: '/settings/security' as Route },
];

export function SettingsSidebar() {
  const pathname = usePathname() ?? '';
  const containerRef = useRef<HTMLElement>(null);

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
      {SECTIONS.map((s) => {
        const active = pathname === s.href || pathname.startsWith(`${s.href}/`);
        return (
          <Link
            key={s.id}
            href={s.href}
            data-settings-nav
            aria-current={active ? 'page' : undefined}
            className={`flex min-h-11 items-center rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring ${
              active ? 'bg-accent font-medium text-accent-foreground' : 'hover:bg-accent/50'
            }`}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
