'use client';

import { Command } from 'cmdk';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { subscribeQuickCapture } from '@/components/quick-capture/controller';
import { Button } from '@/components/ui/button';

type Payload = {
  title: string;
  body: string;
  url: string | null;
};

export function QuickCaptureModal() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => subscribeQuickCapture(() => setOpen(true)), []);

  // Move focus to the title input each time the modal opens. Using a ref +
  // imperative focus() (instead of the autoFocus prop) avoids the biome
  // `lint/a11y/noAutofocus` warning while preserving the keyboard-first UX
  // — the focus only moves in response to the user's explicit open action.
  useEffect(() => {
    if (open) titleRef.current?.focus();
  }, [open]);

  // Reset fields each time the modal closes.
  useEffect(() => {
    if (!open) {
      setTitle('');
      setBody('');
      setUrl('');
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    const urlTrim = url.trim();
    let resolvedUrl: string | null = null;
    if (urlTrim.length > 0) {
      if (!/^https?:\/\//i.test(urlTrim)) {
        setError('URL must start with http:// or https://');
        return;
      }
      resolvedUrl = urlTrim;
    }
    const payload: Payload = { title: title.trim(), body: body.trim(), url: resolvedUrl };
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/inbox', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Capture failed (${res.status})`);
      }
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Capture failed.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[20vh]">
      <button
        type="button"
        aria-label="Close quick capture"
        className="fixed inset-0 bg-black/30"
        onClick={() => setOpen(false)}
      />
      <Command
        role="dialog"
        aria-label="Quick capture"
        className="relative w-full max-w-lg overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl"
      >
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-3 p-4">
          <div>
            <label htmlFor="qc-title" className="block text-xs font-medium text-muted-foreground">
              Title
            </label>
            <input
              id="qc-title"
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label htmlFor="qc-body" className="block text-xs font-medium text-muted-foreground">
              Note
            </label>
            <textarea
              id="qc-body"
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="mt-1 w-full rounded border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label htmlFor="qc-url" className="block text-xs font-medium text-muted-foreground">
              URL (optional)
            </label>
            <input
              id="qc-url"
              type="text"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              className="mt-1 w-full rounded border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save to inbox'}
            </Button>
          </div>
        </form>
      </Command>
    </div>
  );
}
