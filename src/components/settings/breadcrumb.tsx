import type { Route } from 'next';
import Link from 'next/link';

export function SettingsBreadcrumb({
  section,
  page,
}: {
  section: { label: string; href: Route };
  page: string;
}) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-foreground">
      <ol className="flex items-center gap-2">
        <li>
          <Link href={'/settings' as Route} className="hover:text-foreground">
            Settings
          </Link>
        </li>
        <li aria-hidden="true">/</li>
        <li>
          <Link href={section.href} className="hover:text-foreground">
            {section.label}
          </Link>
        </li>
        <li aria-hidden="true">/</li>
        <li aria-current="page" className="text-foreground">
          {page}
        </li>
      </ol>
    </nav>
  );
}
