'use client';

import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

type Visibility = 'private' | 'workspace' | 'public';

export type SaveAsTemplateDialogProps = {
  open: boolean;
  pageId: string;
  defaultName: string;
  onClose: () => void;
  onSaved?: (templateId: string) => void;
};

/**
 * v0.9 G4 P25 — modal collecting (name, visibility) for the "save page as
 * template" action. POSTs to /api/templates/save-from-page. Esc closes; click
 * on the overlay closes. Not a true focus-trap modal — keeps the surface
 * lightweight to match the existing PageMenu popover idiom.
 */
export function SaveAsTemplateDialog(props: SaveAsTemplateDialogProps) {
  const { open, pageId, defaultName, onClose, onSaved } = props;
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(defaultName);
  const [visibility, setVisibility] = useState<Visibility>('workspace');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(defaultName);
    setVisibility('workspace');
    setError(null);
    setSubmitting(false);
  }, [open, defaultName]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/templates/save-from-page', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pageId, name: name.trim(), visibility }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({ error: 'failed' }))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as { templateId: string };
      onSaved?.(body.templateId);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop close on click; Esc handler above wires keyboard dismissal
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop close on click; Esc handler above wires keyboard dismissal
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: stop propagation so clicks inside the dialog don't close it; Esc + the form submit / cancel handle keyboard dismissal */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stop propagation so clicks inside the dialog don't close it; Esc + the form submit / cancel handle keyboard dismissal */}
      <div
        ref={dialogRef}
        className="w-[420px] max-w-[92vw] rounded-lg border bg-background p-4 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="mb-3 text-base font-semibold">
          Save as template
        </h2>
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Name</span>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border bg-background px-2 py-1 text-sm"
              maxLength={200}
            />
          </label>
          <fieldset className="space-y-1 text-sm">
            <legend className="mb-1 block font-medium">Visibility</legend>
            {(['private', 'workspace', 'public'] as const).map((v) => (
              <label key={v} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="visibility"
                  value={v}
                  checked={visibility === v}
                  onChange={() => setVisibility(v)}
                />
                <span className="capitalize">{v}</span>
                <span className="text-xs text-muted-foreground">
                  {v === 'private'
                    ? '— only this workspace'
                    : v === 'workspace'
                      ? '— every workspace member'
                      : '— anyone with /templates access'}
                </span>
              </label>
            ))}
          </fieldset>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || name.trim() === ''}>
              {submitting ? 'Saving…' : 'Save template'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
