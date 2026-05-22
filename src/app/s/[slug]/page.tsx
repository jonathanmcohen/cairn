import type { Route } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDb } from '@/db/client';
import { getPublicSitePages } from '@/lib/pages/public-site';

export const metadata = {
  robots: { index: false, follow: false },
};

export default async function PublicSitePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const site = await getPublicSitePages(getDb(), slug);
  if (!site) notFound();

  // Roots = pages with no parent, or whose parent is not in the published set.
  const ids = new Set(site.pages.map((p) => p.id));
  const roots = site.pages.filter((p) => p.parentId === null || !ids.has(p.parentId));

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <nav>
        <ul className="space-y-2">
          {roots.map((p) => (
            <li key={p.id}>
              <Link
                href={`/p/${p.slug}` as Route}
                className="flex items-center gap-2 text-lg hover:underline"
              >
                {p.icon && <span aria-hidden>{p.icon}</span>}
                {p.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
