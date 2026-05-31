'use client';

import { useEffect, useState } from 'react';
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
import { useT } from '@/lib/i18n/provider';
import {
  type EditorDialogField,
  type EditorDialogRequest,
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

const SPECS: Record<EditorDialogRequest['kind'], Spec> = {
  footnote: {
    confirmLabel: 'Add',
    fields: [{ name: 'text', label: 'Footnote text', required: true }],
  },
  citation: {
    confirmLabel: 'Insert',
    fields: [
      { name: 'author', label: 'Author (Last, F.)', required: true },
      { name: 'title', label: 'Title', required: true },
      { name: 'year', label: 'Year', placeholder: 'e.g. 2020', required: true },
      { name: 'doi', label: 'DOI (optional)' },
      { name: 'pubmed', label: 'PubMed ID (optional)' },
    ],
  },
  flashcard: {
    confirmLabel: 'Add',
    fields: [
      { name: 'front', label: 'Front (question)', required: true },
      { name: 'back', label: 'Back (answer)', required: true },
      { name: 'deck', label: 'Deck tag (optional)' },
    ],
  },
};

function blankValues(fields: EditorDialogField[]): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f.name, f.defaultValue ?? '']));
}

export function EditorDialogs() {
  const t = useT();
  const [request, setRequest] = useState<EditorDialogRequest | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    return subscribeEditorDialog((req) => {
      setValues(blankValues(SPECS[req.kind].fields));
      setRequest(req);
    });
  }, []);

  const settle = (result: Record<string, string> | null) => {
    const req = request;
    setRequest(null);
    req?.resolve(result);
  };

  const spec = request ? SPECS[request.kind] : null;
  const canSubmit = spec?.fields.every((f) => !f.required || values[f.name]?.trim()) ?? false;

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) settle(null);
      }}
    >
      {request !== null && spec !== null && (
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
