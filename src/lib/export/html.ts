import { marked } from 'marked';
import { pageToMarkdown } from './renderers';

// biome-ignore lint/suspicious/noExplicitAny: page shape mirrors export renderers
type ExportPage = { id: string; title: string; content: any };

const HTML_ESCAPES: Record<string, string> = {
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  '"': '&quot;',
};

/**
 * Standalone, themed HTML export (#56). Same block coverage as Markdown
 * (`pageToMarkdown` → `marked`) and the same print-friendly stylesheet as the
 * PDF-print path, but WITHOUT the auto-`window.print()` script — this is a
 * file the user keeps/serves, not a print trigger.
 */
export function pageToHtml(page: ExportPage): string {
  const bodyHtml = marked.parse(pageToMarkdown(page), { async: false }) as string;
  const safeTitle = page.title.replace(/[<>&"]/g, (c) => HTML_ESCAPES[c] ?? c);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.5; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; color: #111; }
  h1 { font-size: 2em; border-bottom: 1px solid #ddd; padding-bottom: 0.2em; }
  pre { background: #f6f6f6; padding: 0.8em; border-radius: 4px; overflow: auto; }
  code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.92em; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #ddd; padding-left: 1em; color: #555; margin-left: 0; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ccc; padding: 0.4em 0.6em; }
  img { max-width: 100%; }
  ul, ol { padding-left: 1.4em; }
</style>
</head>
<body>
<h1>${safeTitle}</h1>
${bodyHtml}
</body>
</html>`;
}
