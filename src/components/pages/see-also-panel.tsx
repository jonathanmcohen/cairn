import type { Route } from 'next';
import Link from 'next/link';
import { getDb } from '@/db/client';
import { findRelatedPages } from '@/lib/search/see-also';

export type SeeAlsoPanelProps = {
  /** The page whose neighbors to surface. */
  pageId: string;
  /** Signed-in viewer (null on /p/<slug>). */
  viewerUserId: string | null;
  /** True on /p/<slug>. Bypasses ACL gating. */
  publicViewer?: boolean;
  /** Max items to render. Defaults to 5. */
  limit?: number;
};

/**
 * RSC "See also" panel. Async Server Component — call sites await its JSX.
 * Renders null when there are no related pages so the parent doesn't have to
 * gate on the result; the panel is invisible when irrelevant.
 *
 * Encryption-blind by construction — `findRelatedPages` excludes
 * `encrypted=true` rows server-side (spec §4 runtime impact).
 */
export async function SeeAlsoPanel(props: SeeAlsoPanelProps) {
  const db = getDb();
  const related = await findRelatedPages(db, {
    pageId: props.pageId,
    viewerUserId: props.viewerUserId,
    publicViewer: props.publicViewer,
    limit: props.limit ?? 5,
  });

  if (related.length === 0) return null;

  return (
    <section
      className="rounded-md border bg-muted/20 p-3 text-sm"
      aria-labelledby="see-also-heading"
    >
      <h2
        id="see-also-heading"
        className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      >
        See also
      </h2>
      <nav aria-label="See also">
        <ul className="space-y-2">
          {related.map((r) => (
            <li key={r.id}>
              <Link
                href={`/pages/${r.id}` as Route}
                className="block rounded p-1 hover:bg-accent/50"
              >
                <div className="flex items-center gap-2">
                  <span aria-hidden="true">{r.icon ?? '📄'}</span>
                  <span className="font-medium">{r.title}</span>
                  <span
                    className="ml-auto text-xs tabular-nums text-muted-foreground"
                    title={`similarity ${Math.round(r.score * 100)} percent`}
                  >
                    {Math.round(r.score * 100)}%
                  </span>
                </div>
                {r.snippet ? (
                  <p className="line-clamp-2 text-xs text-muted-foreground">{r.snippet}</p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}
