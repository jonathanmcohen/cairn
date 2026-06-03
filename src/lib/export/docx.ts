import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { pageToMarkdown } from './renderers';

// biome-ignore lint/suspicious/noExplicitAny: page shape mirrors export renderers
type ExportPage = { id: string; title: string; content: any };

const HEADING = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

/**
 * Word (.docx) export (#56). Pure-JS via the `docx` package — no pandoc/
 * Chromium binary, so it runs identically on GitHub-hosted CI and in the
 * single-container deploy. Maps the page's Markdown line-by-line to
 * paragraphs. Deliberately lossy vs. pandoc: inline math is flattened to its
 * LaTeX source and code blocks render as monospace paragraphs without syntax
 * highlighting (documented tradeoff in v0.9.9-plan-n-export-publish.md).
 */
export async function pageToDocx(page: ExportPage): Promise<Buffer> {
  const md = pageToMarkdown(page);
  const lines = md.split('\n');
  const children: Paragraph[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(page.title)] }),
  ];
  let inFence = false;
  for (const line of lines) {
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      children.push(
        new Paragraph({ children: [new TextRun({ text: line, font: 'Courier New' })] }),
      );
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h?.[1] && h[2] !== undefined) {
      children.push(
        new Paragraph({ heading: HEADING[h[1].length - 1], children: [new TextRun(h[2])] }),
      );
      continue;
    }
    children.push(new Paragraph({ children: [new TextRun(line)] }));
  }
  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}
