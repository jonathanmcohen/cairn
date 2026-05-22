import katex from 'katex';

/**
 * Pure latex → safe HTML renderer (no browser / TipTap needed, so it unit-tests
 * directly). KaTeX's `renderToString` emits sanitized, local-only markup from
 * trusted local input; `throwOnError: false` makes invalid latex render an
 * inline `.katex-error` span instead of throwing, so a bad equation degrades
 * gracefully rather than crashing the editor. Empty input renders a thin space
 * (`\,`) placeholder so the node has a visible click target while editing.
 */
export function renderMath(latex: string, display = false): string {
  try {
    return katex.renderToString(latex || '\\,', { displayMode: display, throwOnError: false });
  } catch {
    return '';
  }
}
