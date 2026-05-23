import { proseToMarkdown } from '@/lib/markdown/from-prose';

// Shapes are intentionally loose — these renderers consume "already-loaded" data
// the workspace-archive assembler hands them. Trivially testable.
// biome-ignore lint/suspicious/noExplicitAny: export shapes are heterogeneous
type ExportPage = { id: string; title: string; content: any };

type ExportDbProperty = { id: string; name: string; type: string };
type ExportDbRow = { id: string; cells: Record<string, unknown> };
type ExportDatabase = {
  id: string;
  name: string;
  properties: ExportDbProperty[];
  rows: ExportDbRow[];
};

/** ProseMirror page → Markdown via the existing exporter (reuses block coverage). */
export function pageToMarkdown(page: ExportPage): string {
  return proseToMarkdown(page.content);
}

/** Identity-shape JSON — the importer expects this shape on the inverse path. */
export function pageToJson(page: ExportPage): { id: string; title: string; content: unknown } {
  return { id: page.id, title: page.title, content: page.content };
}

/** RFC-4180 CSV escape: wrap in quotes if value contains `,`/`"`/newline; double internal quotes. */
function csvEscape(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  const s = String(value);
  if (/[,"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function databaseToCsv(db: ExportDatabase): string {
  const header = db.properties.map((p) => csvEscape(p.name)).join(',');
  const lines = db.rows.map((r) => db.properties.map((p) => csvEscape(r.cells[p.id])).join(','));
  return `${[header, ...lines].join('\n')}\n`;
}

export function databaseToJson(db: ExportDatabase): ExportDatabase {
  return { id: db.id, name: db.name, properties: db.properties, rows: db.rows };
}
