export type ImportWarning = { item: string; message: string };
export type ImportReport = {
  source: 'notion' | 'markdown-folder' | 'workspace-archive';
  counts: { pages: number; databases: number; rows: number; files: number };
  warnings: ImportWarning[];
};

export function emptyReport(source: ImportReport['source']): ImportReport {
  return {
    source,
    counts: { pages: 0, databases: 0, rows: 0, files: 0 },
    warnings: [],
  };
}
