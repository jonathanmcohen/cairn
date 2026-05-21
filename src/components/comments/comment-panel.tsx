'use client';

import { Check, RotateCcw, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Comment } from '@/db/schema';
import type { MemberRole } from '@/lib/auth/require-role';
import type { CommentAnchor } from '@/lib/comments/anchor';

const ROLE_RANK: Record<MemberRole, number> = { viewer: 1, editor: 2, admin: 3, owner: 4 };

function hasMinRole(actual: MemberRole, required: MemberRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

type CommentPanelProps = {
  pageId: string;
  canComment: boolean;
  currentUserId: string;
  currentRole: MemberRole;
  open: boolean;
  onClose: () => void;
};

function isBlockAnchor(anchor: CommentAnchor | null): anchor is { blockId: string } {
  return anchor != null && 'blockId' in anchor;
}

/**
 * Scrolls a block-anchored comment's target into view and flashes a transient
 * highlight. Block ids are stamped as `data-block-id`; if the editor has not
 * stamped one (the attribute is absent in v0.3.0), this is a safe no-op.
 */
function scrollToBlock(blockId: string) {
  const el = document.querySelector(`[data-block-id="${CSS.escape(blockId)}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('comment-anchor-flash');
  setTimeout(() => el.classList.remove('comment-anchor-flash'), 1500);
}

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

export function CommentPanel({
  pageId,
  canComment,
  currentUserId,
  currentRole,
  open,
  onClose,
}: CommentPanelProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  const canResolve = hasMinRole(currentRole, 'editor');

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/pages/${pageId}/comments`);
    if (!res.ok) {
      setError('Failed to load comments');
      return;
    }
    setComments((await res.json()) as Comment[]);
    setError(null);
  }, [pageId]);

  useEffect(() => {
    if (open) void refetch();
  }, [open, refetch]);

  async function addComment() {
    const body = draft.trim();
    if (!body) return;
    setSubmitting(true);
    setError(null);
    const res = await fetch(`/api/pages/${pageId}/comments`, {
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

  if (!open) return null;

  const unresolved = comments.filter((c) => c.resolvedAt == null);
  const resolved = comments.filter((c) => c.resolvedAt != null);

  function renderRow(comment: Comment) {
    const canDelete = comment.authorId === currentUserId || hasMinRole(currentRole, 'admin');
    const anchor = comment.anchor;
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
        {anchor != null &&
          (isBlockAnchor(anchor) ? (
            <button
              type="button"
              className="text-primary mt-1 text-xs underline hover:no-underline"
              onClick={() => scrollToBlock(anchor.blockId)}
            >
              Jump to block
            </button>
          ) : (
            <span className="text-muted-foreground mt-1 inline-block text-xs" title="range anchor">
              range anchor
            </span>
          ))}
      </li>
    );
  }

  return (
    <aside className="bg-background flex h-full w-80 flex-col border-l">
      <div className="flex items-center justify-between border-b p-3">
        <h2 className="text-sm font-medium">Comments</h2>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Close" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
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
            {showResolved && (
              <ul className="mt-2 space-y-2 opacity-70">{resolved.map(renderRow)}</ul>
            )}
          </div>
        )}
      </div>

      {canComment && (
        <div className="space-y-2 border-t p-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a comment…"
            rows={3}
            className="border-input bg-background focus-visible:ring-ring w-full resize-none rounded-md border px-2 py-1.5 text-sm focus-visible:outline-hidden focus-visible:ring-1"
          />
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
    </aside>
  );
}
