/**
 * Framework-free pub/sub bridge so imperative TipTap slash commands (which run
 * outside React and cannot call hooks) can drive a themed dialog. The single
 * subscriber is the `<EditorDialogs>` host mounted near the editor; it renders
 * `InputDialog` (single field) or a small multi-field form dialog and calls
 * `resolve` with the entered values, or `null` on cancel.
 *
 * Why a bus and not a hook: `SlashCommand.suggestion.command` is a plain
 * callback on the ProseMirror plugin — there is no React render context there.
 * The bus keeps slash commands hook-free while reusing the app's themed
 * dialog primitives. Mirrors the ConfirmProvider/InputDialogProvider promise
 * contract: a falsy/null result means "cancelled", so existing early-return
 * guards (`if (!x) return`) keep working.
 */

import type { CitationStyle } from '@/components/editor/blocks/citation-add-dialog';
import type { CitationMeta, FormattedCitation } from '@/lib/citations/types';

/** A single field in a multi-field editor form dialog. */
export type EditorDialogField = {
  name: string;
  label: string;
  placeholder?: string;
  /** Optional default value pre-filled in the field. */
  defaultValue?: string;
  /** When true the submit handler rejects an empty value. Defaults to false. */
  required?: boolean;
};

/** Discriminated request payloads, one per slash command that needs input. */
export type EditorDialogSpec =
  | { kind: 'footnote'; title: string; description?: string }
  | { kind: 'citation'; title: string; description?: string }
  | { kind: 'flashcard'; title: string; description?: string }
  | {
      kind: 'citationLookup';
      title: string;
      description?: string;
      /** Pre-selected citation style for the lookup dialog. Defaults to 'apa'. */
      defaultStyle?: CitationStyle;
    };

/** The resolved value of a form-dialog request (footnote/citation/flashcard). */
export type EditorDialogFormResult = Record<string, string>;

/** The resolved value of a DOI/PubMed lookup request. */
export type EditorDialogCitationResult = {
  kind: 'citationLookup';
  meta: CitationMeta;
  formatted: FormattedCitation;
  style: CitationStyle;
};

/** Resolved values, keyed by field name (form dialogs), or the structured
 *  citation-lookup result, or null on cancel. */
export type EditorDialogResult = EditorDialogFormResult | EditorDialogCitationResult | null;

/**
 * Narrow a resolved dialog result to the plain form-field record. Returns the
 * record for footnote/citation/flashcard submits, or `null` for the structured
 * citation-lookup result and for cancellation. Lets the form-dialog slash
 * callers keep their `const v = result?.field` ergonomics now that the result
 * union also carries the discriminated `citationLookup` shape.
 */
export function asFormResult(result: EditorDialogResult): EditorDialogFormResult | null {
  if (result === null) return null;
  if ('kind' in result && result.kind === 'citationLookup') return null;
  return result as EditorDialogFormResult;
}

export type EditorDialogRequest = EditorDialogSpec & {
  resolve: (result: EditorDialogResult) => void;
};

type Subscriber = (req: EditorDialogRequest) => void;

let subscriber: Subscriber | null = null;

/**
 * Register the host. Returns an unsubscribe fn. Only one subscriber is
 * supported (there is one editor host per page); a second call replaces the
 * first, matching React effect cleanup ordering.
 */
export function subscribeEditorDialog(handler: Subscriber): () => void {
  subscriber = handler;
  return () => {
    if (subscriber === handler) subscriber = null;
  };
}

/**
 * Open a dialog from imperative code. Resolves with the entered values, or
 * `null` if cancelled or if no host is mounted (so a slash command in a
 * host-less context fails closed rather than hanging forever).
 */
export function openEditorDialog(spec: EditorDialogSpec): Promise<EditorDialogResult> {
  return new Promise<EditorDialogResult>((resolve) => {
    if (!subscriber) {
      resolve(null);
      return;
    }
    subscriber({ ...spec, resolve });
  });
}

/** Test-only: clear the subscriber between cases. */
export function resetEditorDialogBus(): void {
  subscriber = null;
}
