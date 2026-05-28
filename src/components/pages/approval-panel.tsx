/**
 * v0.9.0 G4 P24 — ApprovalPanel.
 *
 * Client component mounted from the page header. Renders:
 *   - the three decision buttons (Approve / Request changes / Reject) when
 *     `canDecide && inReview`
 *   - an optional comment textarea
 *   - the reverse-chronological approval history (always shown when any rows
 *     exist or the page is in review)
 *
 * Returns `null` when not in review AND no history rows are loaded — the
 * common steady-state for most pages.
 */
'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

type Decision = 'approved' | 'rejected' | 'requested_changes';

type HistoryItem = {
  id: string;
  decision: Decision;
  approverUserId: string;
  approvedAt: string;
  comment: string | null;
  versionSnapshotId: string;
  signatureHmac: string;
};

const DECISION_LABEL: Record<Decision, string> = {
  approved: 'Approved',
  rejected: 'Rejected',
  requested_changes: 'Changes requested',
};

export function ApprovalPanel(props: {
  pageId: string;
  canDecide: boolean;
  inReview: boolean;
}): React.ReactElement | null {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/pages/${props.pageId}/approval`)
      .then((r) => (r.ok ? r.json() : Promise.resolve({ history: [] })))
      .then((data: { history?: HistoryItem[] }) => {
        if (!cancelled) setHistory(data.history ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [props.pageId]);

  const showButtons = props.canDecide && props.inReview;
  if (!props.inReview && history.length === 0) return null;

  const submit = async (decision: Decision): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/pages/${props.pageId}/approval/decide`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, comment: comment || undefined }),
      });
      if (!res.ok) {
        setError(`Decision failed (${res.status})`);
        return;
      }
      const fresh = await fetch(`/api/pages/${props.pageId}/approval`).then((r) => r.json());
      setHistory(fresh.history ?? []);
      setComment('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <aside
      aria-label="Page approval"
      className="my-4 rounded-md border bg-amber-50/30 p-4 dark:bg-amber-950/20"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide">Approval</h2>
      {showButtons && (
        <div className="mt-3 space-y-2">
          <textarea
            placeholder="Comment (optional)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            aria-label="Approval comment"
            className="w-full rounded-md border border-input bg-background p-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            rows={2}
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => submit('approved')} disabled={submitting} size="sm">
              Approve
            </Button>
            <Button
              variant="outline"
              onClick={() => submit('requested_changes')}
              disabled={submitting}
              size="sm"
            >
              Request changes
            </Button>
            <Button
              variant="destructive"
              onClick={() => submit('rejected')}
              disabled={submitting}
              size="sm"
            >
              Reject
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
      {history.length > 0 && (
        <ol className="mt-4 space-y-2 text-sm">
          {history.map((h) => (
            <li key={h.id} className="rounded border bg-background p-2">
              <span className="font-mono text-xs">{DECISION_LABEL[h.decision]}</span> by{' '}
              <span className="font-mono text-xs">{h.approverUserId.slice(0, 8)}</span>{' '}
              <time dateTime={h.approvedAt} className="text-muted-foreground">
                {new Date(h.approvedAt).toLocaleString()}
              </time>
              {h.comment && <p className="mt-1 text-muted-foreground">{h.comment}</p>}
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
