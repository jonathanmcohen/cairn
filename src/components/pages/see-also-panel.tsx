import type { Route } from 'next';
import { cookies, headers } from 'next/headers';
import Link from 'next/link';
import { InlineIcon } from '@/components/page-icon-inline';
import { getDb } from '@/db/client';
import { LOCALE_COOKIE } from '@/lib/i18n/config';
import { getMessages } from '@/lib/i18n/messages';
import { resolveLocale } from '@/lib/i18n/resolve';
import { createT } from '@/lib/i18n/t';
import { findRelatedPages } from '@/lib/search/see-also';

/**
 * v0.9.9 F6 (#219) — resolve the request locale for this Server Component the
 * same way the root layout does (cookie → Accept-Language). Defensive: in unit
 * tests the component is awaited directly with no request scope, so cookies()
 * throws — fall back to the English catalog.
 */
async function serverT() {
  try {
    const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
    const locale = resolveLocale(
      cookieStore.get(LOCALE_COOKIE)?.value ?? null,
      headerStore.get('accept-language'),
    );
    return createT(locale, getMessages(locale));
  } catch {
    return createT('en', getMessages('en'));
  }
}

/**
 * Render a related page's stored icon string via the shared client-safe
 * {@link InlineIcon} so the `emoji::`/`file::` shortcode prefix never leaks into
 * the DOM. File-backed icons collapse to a neutral 🖼️ placeholder here — the
 * compact panel intentionally does not resolve signed image URLs.
 */
function renderRelatedIcon(stored: string | null): React.ReactNode {
  return <InlineIcon value={stored} fileFallback="🖼️" />;
}

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

  const t = await serverT();
  const matchStrengthLabel = t('seeAlso.matchStrength');

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
                  <span aria-hidden="true">{renderRelatedIcon(r.icon)}</span>
                  <span className="font-medium">{r.title}</span>
                  <span
                    className="ml-auto text-xs tabular-nums text-muted-foreground"
                    title={t('seeAlso.similarityTooltip', { percent: Math.round(r.score * 100) })}
                  >
                    {Math.round(r.score * 100)}%
                  </span>
                </div>
                {r.snippet ? (
                  <p className="line-clamp-2 text-xs text-muted-foreground">{r.snippet}</p>
                ) : null}
                {/* v0.9.9 F6 (#219) — relative match-strength bar so neighbors
                    look visibly different even when absolute cosines cluster. */}
                {/* biome-ignore lint/a11y/useSemanticElements: a styled <meter> cannot host the inner fill bar (its appearance is non-customizable across browsers); a div with role="meter" + aria-value* gives the same semantics with the gradient fill. */}
                <div
                  role="meter"
                  aria-label={matchStrengthLabel}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round((r.relativeScore ?? 0) * 100)}
                  title={matchStrengthLabel}
                  className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className="h-full rounded-full bg-primary/60"
                    style={{ width: `${(r.relativeScore ?? 0) * 100}%` }}
                  />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}
