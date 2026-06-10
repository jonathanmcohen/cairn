'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useFocusTrap } from '@/lib/a11y/focus-trap';
import { renderMath } from '@/lib/editor/math-render';
import { useT } from '@/lib/i18n/provider';

/**
 * v0.9.9 Plan E1a (#246/#274) — "Insert equation" dialog with a live KaTeX
 * preview. Replaces the old "drop an empty math node, then click it" flow with
 * a modal-first input: a LaTeX field + display(block) toggle + live preview.
 * Self-contained shell (fixed backdrop + a11y attrs + Esc-to-close + focus
 * trap), mirroring `citation-add-dialog.tsx`.
 */

export type EquationAddDialogProps = {
  open: boolean;
  onClose: () => void;
  onInsert: (latex: string, display: boolean) => void;
};

export function EquationAddDialog({ open, onClose, onInsert }: EquationAddDialogProps) {
  const t = useT();
  const [latex, setLatex] = useState('');
  const [display, setDisplay] = useState(true);
  const inputId = useId();
  const titleId = useId();
  const dialogRef = useFocusTrap<HTMLDivElement>(open, false); // A2 #76 — EditorDialogs owns focus restore
  const preview = useMemo(() => renderMath(latex, display), [latex, display]);

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
          {t('editor.equation.title')}
        </h2>
        <div className="space-y-2">
          <Label htmlFor={inputId}>{t('editor.equation.latexLabel')}</Label>
          <textarea
            id={inputId}
            // biome-ignore lint/a11y/noAutofocus: focus trap returns this field first; explicit autofocus avoids a flash.
            autoFocus
            value={latex}
            onChange={(e) => setLatex(e.target.value)}
            placeholder={t('editor.equation.latexPlaceholder')}
            className="w-full rounded border bg-background p-2 font-mono text-xs"
            rows={3}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={display} onChange={(e) => setDisplay(e.target.checked)} />
          {t('editor.equation.displayLabel')}
        </label>
        <div
          aria-live="polite"
          className="min-h-12 rounded border bg-muted/40 p-3 text-center text-sm"
          data-testid="equation-preview"
          // KaTeX output is sanitized HTML from the local trusted renderer (no remote input).
          // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX-rendered math, local-only.
          dangerouslySetInnerHTML={{ __html: latex.trim() ? preview : '' }}
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!latex.trim()}
            onClick={() => {
              if (!latex.trim()) return;
              onInsert(latex, display);
              setLatex('');
              onClose();
            }}
          >
            {t('common.add')}
          </Button>
        </div>
      </div>
    </div>
  );
}
