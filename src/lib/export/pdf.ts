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
 * Render a page as print-ready HTML. The browser handles the PDF conversion
 * via its native print dialog (`window.print()` → "Save as PDF"). This avoids
 * a headless-Chromium / pdfkit dependency in the server image, at the cost of
 * one extra user click. Documented as the v0.6.0 PDF export contract.
 */
export function pageToPdfHtml(page: ExportPage): string {
  const bodyHtml = marked.parse(pageToMarkdown(page), { async: false }) as string;
  const safeTitle = page.title.replace(/[<>&"]/g, (c) => HTML_ESCAPES[c] ?? c);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<style>
  @page { margin: 1in; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.5; max-width: 8in; margin: 0 auto; color: #111; }
  h1, h2, h3, h4, h5, h6 { margin-top: 1.2em; margin-bottom: 0.4em; line-height: 1.2; }
  h1 { font-size: 2em; border-bottom: 1px solid #ddd; padding-bottom: 0.2em; }
  pre { background: #f6f6f6; padding: 0.8em; border-radius: 4px; overflow: auto; }
  code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.92em; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #ddd; padding-left: 1em; color: #555; margin-left: 0; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ccc; padding: 0.4em 0.6em; }
  img { max-width: 100%; }
  ul, ol { padding-left: 1.4em; }
  @media print {
    body { max-width: none; }
    a { color: inherit; text-decoration: none; }
  }
</style>
</head>
<body>
<h1>${safeTitle}</h1>
${bodyHtml}
<script>
  // Auto-open the browser print dialog on load. Users pick "Save as PDF".
  window.addEventListener('load', () => setTimeout(() => window.print(), 100));
</script>
</body>
</html>`;
}
