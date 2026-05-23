'use client';

import { Check, RotateCcw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Comment } from '@/db/schema';
import { hasMinRole, type MemberRole } from '@/lib/auth/require-role';
import type { CommentTargetType } from '@/lib/comments/target';
import { CommentComposer } from './comment-composer';

/**
 * Formats an ISO timestamp as a short relative-time string. Mirrors the helper
 * used by the v0.3.0 page comment panel so row/file comments read identically.
 */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

type TargetCommentPanelProps = {
  target: { type: Extract<CommentTargetType, 'db_row' | 'file'>; id: string };
  listUrl: string;
  postUrl: string;
  canComment: boolean;
  currentUserId: string;
  currentRole: MemberRole;
};

/**
 * Target-generic comment panel for row and file comments. It mirrors the v0.3.0
 * page comment panel's fetch/error/resolve/delete behavior but takes its
 * endpoints as props and renders no anchor chip (row/file comments are never
 * anchored). Resolve/reopen requires editor+; delete requires author or admin+.
 */
export function TargetCommentPanel({
  target,
  listUrl,
  postUrl,
  canComment,
  currentUserId,
  currentRole,
}: TargetCommentPanelProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  const canResolve = hasMinRole(currentRole, 'editor');

  const refetch = useCallback(async () => {
    const res = await fetch(listUrl);
    if (!res.ok) {
      setError('Failed to load comments');
      return;
    }
    setComments((await res.json()) as Comment[]);
    setError(null);
  }, [listUrl]);

  // Reload on mount and whenever the target changes (target.id flows into
  // listUrl, so refetch's identity tracks it).
  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function addComment() {
    const body = draft.trim();
    if (!body) return;
    setSubmitting(true);
    setError(null);
    const res = await fetch(postUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    setSubmitting(false);
    if (!res.ok) {
      setError('Failed to add comment');
      return;
    }
    const created = (await res.json()) as Comment;
    setComments((prev) => [...prev, created]);
    setDraft('');
  }

  async function setResolved(comment: Comment, resolved: boolean) {
    const res = await fetch(`/api/comments/${comment.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resolved }),
    });
    if (!res.ok) {
      setError('Failed to update comment');
      return;
    }
    const updated = (await res.json()) as Comment;
    setComments((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }

  async function removeComment(comment: Comment) {
    const res = await fetch(`/api/comments/${comment.id}`, { method: 'DELETE' });
    if (res.status === 204) {
      setComments((prev) => prev.filter((c) => c.id !== comment.id));
      return;
    }
    setError(res.status === 403 ? 'Not allowed to delete' : 'Failed to delete comment');
  }

  const unresolved = comments.filter((c) => c.resolvedAt == null);
  const resolved = comments.filter((c) => c.resolvedAt != null);

  function renderRow(comment: Comment) {
    const canDelete = comment.authorId === currentUserId || hasMinRole(currentRole, 'admin');
    return (
      <li key={comment.id} className="rounded-md border p-3 text-sm">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs">
            {comment.authorId === currentUserId ? 'You' : comment.authorId.slice(0, 8)}
            {' · '}
            {relativeTime(new Date(comment.createdAt).toISOString())}
          </span>
          <div className="flex items-center gap-1">
            {canResolve &&
              (comment.resolvedAt == null ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  title="Resolve"
                  onClick={() => void setResolved(comment, true)}
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  title="Reopen"
                  onClick={() => void setResolved(comment, false)}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              ))}
            {canDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                title="Delete"
                onClick={() => void removeComment(comment)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
        <p className="whitespace-pre-wrap break-words">{comment.body}</p>
      </li>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-destructive text-xs">{error}</p>}
      {unresolved.length === 0 && resolved.length === 0 && (
        <p className="text-muted-foreground text-xs">No comments yet.</p>
      )}
      <ul className="space-y-2">{unresolved.map(renderRow)}</ul>
      {resolved.length > 0 && (
        <div className="pt-2">
          <button
            type="button"
            className="text-muted-foreground text-xs underline hover:no-underline"
            onClick={() => setShowResolved((v) => !v)}
          >
            {showResolved ? 'Hide' : 'Show'} resolved ({resolved.length})
          </button>
          {showResolved && <ul className="mt-2 space-y-2 opacity-70">{resolved.map(renderRow)}</ul>}
        </div>
      )}

      {canComment && (
        <div className="space-y-2 border-t pt-3">
          <CommentComposer value={draft} onChange={setDraft} onSubmit={() => void addComment()} />
          <Button
            size="sm"
            className="w-full"
            disabled={submitting || draft.trim().length === 0}
            onClick={() => void addComment()}
          >
            {submitting ? 'Adding…' : 'Comment'}
          </Button>
        </div>
      )}
    </div>
  );
}
