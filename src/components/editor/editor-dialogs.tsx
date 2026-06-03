'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CitationAddDialog,
  type CitationStyle,
} from '@/components/editor/blocks/citation-add-dialog';
import { EquationAddDialog } from '@/components/editor/blocks/equation-add-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CitationMeta, FormattedCitation } from '@/lib/citations/types';
import { useT } from '@/lib/i18n/provider';
import type { TFunction } from '@/lib/i18n/t';
import {
  type EditorDialogField,
  type EditorDialogRequest,
  type EditorDialogResult,
  subscribeEditorDialog,
} from './editor-dialog-bus';

/**
 * React host for the editor dialog bus. Mounted once near the editor (see
 * `editor.tsx`). Subscribes to `openEditorDialog` requests and renders a
 * themed radix dialog whose fields depend on the request `kind`:
 *
 *   - footnote  → single text field
 *   - citation  → author / title / year / DOI / PubMed
 *   - flashcard → front / back / deck
 *
 * On submit it resolves the request's promise with a `name → value` record;
 * Cancel / Escape / overlay-click resolve `null` (matching the bus contract so
 * the slash command's `if (!result) return` guards keep working).
 */

type Spec = {
  confirmLabel: string;
  fields: EditorDialogField[];
};

// v0.9.9 E1c (#274/#64) — confirm/field labels are i18n-driven (resolved via
// `t`) so the slash modals render in the active locale, matching the
// self-contained equation/citation-lookup dialogs. `citationLookup` has no
// entry here — it renders `CitationAddDialog` via an early-return branch.
function buildSpecs(t: TFunction): Partial<Record<EditorDialogRequest['kind'], Spec>> {
  return {
    footnote: {
      confirmLabel: t('common.add'),
      fields: [{ name: 'text', label: t('editor.footnote.textLabel'), required: true }],
    },
    citation: {
      confirmLabel: t('editor.citation.insert'),
      fields: [
        { name: 'author', label: 'Author (Last, F.)', required: true },
        { name: 'title', label: 'Title', required: true },
        { name: 'year', label: 'Year', placeholder: 'e.g. 2020', required: true },
        { name: 'doi', label: 'DOI (optional)' },
        { name: 'pubmed', label: 'PubMed ID (optional)' },
      ],
    },
    flashcard: {
      confirmLabel: t('common.add'),
      fields: [
        { name: 'front', label: t('editor.flashcard.front'), required: true },
        { name: 'back', label: t('editor.flashcard.back'), required: true },
        { name: 'deck', label: t('editor.flashcard.deck') },
      ],
    },
  };
}

function blankValues(fields: EditorDialogField[]): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f.name, f.defaultValue ?? '']));
}

// v0.9.9 E1b (#274) — DOI/PMID classifiers mirrored from `citation-add-dialog.tsx`
// so the manual citation modal can resolve a pasted identifier inline.
const DOI_RE = /^10\..+\/.+$/;
const PMID_RE = /^\d{6,9}$/;

function classifyId(input: string): { kind: 'doi' | 'pubmed'; value: string } | null {
  const v = input.trim();
  if (DOI_RE.test(v)) return { kind: 'doi', value: v };
  if (PMID_RE.test(v)) return { kind: 'pubmed', value: v };
  return null;
}

type LookupResponse = { meta: CitationMeta; formatted: FormattedCitation };

export function EditorDialogs() {
  const t = useT();
  const [request, setRequest] = useState<EditorDialogRequest | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  // E1b — DOI auto-fetch state for the manual citation modal.
  const [doiLoading, setDoiLoading] = useState(false);
  const [doiError, setDoiError] = useState(false);
  const doiAbortRef = useRef<AbortController | null>(null);
  const specs = useMemo(() => buildSpecs(t), [t]);
  // Read current specs inside the (stable) subscribe handler without
  // re-subscribing on locale change — only field NAMES are needed there.
  const specsRef = useRef(specs);
  specsRef.current = specs;

  useEffect(() => {
    return subscribeEditorDialog((req) => {
      setValues(blankValues(specsRef.current[req.kind]?.fields ?? []));
      setDoiLoading(false);
      setDoiError(false);
      doiAbortRef.current?.abort();
      setRequest(req);
    });
  }, []);

  // E1b (#274) — resolve the DOI/PMID typed into the citation modal's DOI field
  // via the same `/api/citations/lookup` endpoint `/cite-doi` uses, then fill
  // author/title/year so the two citation entry points share one interaction.
  const fetchFromDoi = async () => {
    const cls = classifyId(values.doi ?? '');
    if (!cls) {
      setDoiError(true);
      return;
    }
    doiAbortRef.current?.abort();
    const ac = new AbortController();
    doiAbortRef.current = ac;
    setDoiLoading(true);
    setDoiError(false);
    try {
      const url = `/api/citations/lookup?${cls.kind}=${encodeURIComponent(cls.value)}`;
      const res = await fetch(url, { signal: ac.signal });
      if (!res.ok) throw new Error('lookup failed');
      const data = (await res.json()) as LookupResponse;
      const a = data.meta.authors[0];
      setValues((v) => ({
        ...v,
        author: a ? (a.given ? `${a.family}, ${a.given}` : a.family) : (v.author ?? ''),
        title: data.meta.title ?? v.title ?? '',
        year: data.meta.year != null ? String(data.meta.year) : (v.year ?? ''),
      }));
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setDoiError(true);
    } finally {
      if (!ac.signal.aborted) setDoiLoading(false);
    }
  };

  const settle = (result: EditorDialogResult) => {
    const req = request;
    setRequest(null);
    req?.resolve(result);
  };

  // v0.9.7 G19 #166 — the DOI/PubMed lookup uses its own self-contained dialog
  // (paste-detect + style preview) rather than the generic multi-field form.
  if (request?.kind === 'citationLookup') {
    return (
      <CitationAddDialog
        open
        defaultStyle={request.defaultStyle ?? 'apa'}
        onClose={() => settle(null)}
        onInsert={(meta, formatted, style: CitationStyle) => {
          // Re-derive all three style strings from the returned meta so the
          // inserted node can switch styles without another lookup. The dialog
          // only surfaces the active-style string; the slash `run` recomputes
          // the full FormattedCitation, but we forward what we have here and
          // let the caller fill the rest.
          settle({
            kind: 'citationLookup',
            meta,
            style,
            formatted: {
              apa: style === 'apa' ? formatted : '',
              mla: style === 'mla' ? formatted : '',
              chicago: style === 'chicago' ? formatted : '',
            },
          });
        }}
      />
    );
  }

  // v0.9.9 E1a (#246/#274) — the equation modal collects LaTeX + a display
  // toggle with a live KaTeX preview via its own self-contained dialog.
  if (request?.kind === 'equation') {
    return (
      <EquationAddDialog
        open
        onClose={() => settle(null)}
        onInsert={(latex, display) => settle({ kind: 'equation', latex, display })}
      />
    );
  }

  const spec = request ? specs[request.kind] : null;
  const canSubmit = spec?.fields.every((f) => !f.required || values[f.name]?.trim()) ?? false;

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) settle(null);
      }}
    >
      {request !== null && spec != null && (
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) settle(values);
            }}
          >
            <DialogHeader>
              <DialogTitle>{request.title}</DialogTitle>
              {request.description ? (
                <DialogDescription>{request.description}</DialogDescription>
              ) : null}
            </DialogHeader>
            <div className="grid gap-3 py-4">
              {spec.fields.map((field, i) => (
                <div key={field.name} className="grid gap-1.5">
                  <Label htmlFor={`editor-dialog-${field.name}`}>{field.label}</Label>
                  <Input
                    id={`editor-dialog-${field.name}`}
                    value={values[field.name] ?? ''}
                    placeholder={field.placeholder}
                    onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                    autoFocus={i === 0}
                  />
                </div>
              ))}
              {request.kind === 'citation' && (
                <div className="space-y-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={doiLoading || !values.doi?.trim()}
                    onClick={() => void fetchFromDoi()}
                  >
                    {t('editor.citation.fetchDoi')}
                  </Button>
                  <p aria-live="polite" className="text-muted-foreground text-xs">
                    {doiLoading
                      ? t('editor.citation.fetching')
                      : doiError
                        ? t('editor.citation.fetchFailed')
                        : ''}
                  </p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => settle(null)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {spec.confirmLabel}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
