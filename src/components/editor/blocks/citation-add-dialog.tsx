'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFocusTrap } from '@/lib/a11y/focus-trap';
import type { CitationMeta, FormattedCitation } from '@/lib/citations/types';

/**
 * v0.9.0 G3 P21 — "Add citation" dialog with paste-detect.
 *
 * Triggered from the P18 citation block's empty-state affordance (or the
 * `/cite-doi` slash command). The user pastes a DOI matching `/^10\..+\/.+$/`
 * or a PubMed PMID matching `/^\d{6,9}$/`. The component debounces input via
 * AbortController-canceled refetches, posts to `/api/citations/lookup`, and
 * renders a preview in the chosen style. On Insert, the consumer's
 * `onInsert(meta, formatted, style)` callback runs.
 *
 * The component is intentionally self-contained (no shadcn Dialog
 * dependency) and mirrors the `mint-token-dialog` shell shape — fixed
 * backdrop + a11y attrs + Esc-to-close + focus trap.
 */

export type CitationStyle = 'apa' | 'mla' | 'chicago';

type LookupResponse = { meta: CitationMeta; formatted: FormattedCitation };

const DOI_RE = /^10\..+\/.+$/;
const PMID_RE = /^\d{6,9}$/;

function classify(input: string): { kind: 'doi' | 'pubmed'; value: string } | null {
  const v = input.trim();
  if (DOI_RE.test(v)) return { kind: 'doi', value: v };
  if (PMID_RE.test(v)) return { kind: 'pubmed', value: v };
  return null;
}

export type CitationAddDialogProps = {
  open: boolean;
  onClose: () => void;
  onInsert: (meta: CitationMeta, formatted: string, style: CitationStyle) => void;
  defaultStyle?: CitationStyle;
};

export function CitationAddDialog(props: CitationAddDialogProps) {
  const { open, onClose, onInsert, defaultStyle } = props;
  const [input, setInput] = useState('');
  const [style, setStyle] = useState<CitationStyle>(defaultStyle ?? 'apa');
  const [result, setResult] = useState<LookupResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const styleId = useId();
  const titleId = useId();
  const abortRef = useRef<AbortController | null>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>(open, false); // A2 #76 — EditorDialogs owns focus restore

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    const cls = classify(input);
    if (!cls) {
      setResult(null);
      setError(null);
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    const url = `/api/citations/lookup?${cls.kind}=${encodeURIComponent(cls.value)}`;
    fetch(url, { signal: ac.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error('Lookup failed.');
        return (await r.json()) as LookupResponse;
      })
      .then((data) => {
        if (!ac.signal.aborted) setResult(data);
      })
      .catch((err: unknown) => {
        if ((err as Error).name !== 'AbortError') {
          setError((err as Error).message);
        }
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [input]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg space-y-4 rounded-lg bg-background p-6"
      >
        <h2 id={titleId} className="font-medium text-lg">
          Add citation
        </h2>
        <div className="space-y-2">
          <Label htmlFor={inputId}>DOI or PubMed ID</Label>
          <Input
            id={inputId}
            // biome-ignore lint/a11y/noAutofocus: focus trap returns input as first focusable; explicit autofocus avoids a flash.
            autoFocus
            placeholder="10.1234/abc or 12345678"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>
        <fieldset className="space-y-2">
          <legend id={styleId} className="font-medium text-sm">
            Style
          </legend>
          <div role="radiogroup" aria-labelledby={styleId} className="flex gap-4">
            {(['apa', 'mla', 'chicago'] as const).map((s) => (
              <label key={s} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={styleId}
                  value={s}
                  checked={style === s}
                  onChange={() => setStyle(s)}
                />
                {s.toUpperCase()}
              </label>
            ))}
          </div>
        </fieldset>
        <div
          aria-live="polite"
          className="rounded border bg-muted/40 p-3 text-sm"
          data-testid="citation-preview"
        >
          {loading && <p className="text-muted-foreground">Looking up…</p>}
          {error && <p className="text-destructive">{error}</p>}
          {!loading && !error && result && <p>{result.formatted[style]}</p>}
          {!loading && !error && !result && (
            <p className="text-muted-foreground">
              Paste a DOI (e.g. 10.1234/abc) or PubMed ID to preview.
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!result}
            onClick={() => {
              if (!result) return;
              onInsert(result.meta, result.formatted[style], style);
              setInput('');
              setResult(null);
              onClose();
            }}
          >
            Insert
          </Button>
        </div>
      </div>
    </div>
  );
}
