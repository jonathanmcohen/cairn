import { Open } from 'unzipper';
import { FLASHCARDS_ARCHIVE_PATH, type FlashcardsArchive } from '@/lib/export/flashcards-archive';
import type { TemplateDatabase, TemplatePayload } from '@/lib/templates/payload';
import { buildRemap, rewriteRefs } from '@/lib/templates/rewrite';
import { emptyReport, type ImportReport } from './report';

export type WorkspaceArchiveResult = {
  payload: TemplatePayload;
  /** Map of original file blob path → buffer, for re-hosting via FileStorage. */
  blobs: Map<string, Buffer>;
  /**
   * F1 Task D — original page id → freshly-minted page id. Flashcards are
   * restored by `(restored page id, block_id)`, so the importer needs this map
   * to translate each card's exported source page id to its new home.
   */
  pageIdRemap: Map<string, string>;
  /** F1 Task D — parsed flashcards section (null when the archive omits it). */
  flashcards: FlashcardsArchive | null;
  /** Original manifest, for audit metadata. */
  manifest: { format: string; counts: { pages: number; databases: number; files: number } };
  report: ImportReport;
};

type RawPage = { id: string; title: string; content: unknown };
type RawDbProperty = { id: string; name: string; type: string };
type RawDbRow = { id: string; cells: Record<string, unknown> };
type RawDatabase = {
  id: string;
  name: string;
  properties: RawDbProperty[];
  rows: RawDbRow[];
};

const SUPPORTED_FORMAT = 'cairn-workspace-archive@1';

/**
 * Read a workspace-archive ZIP produced by `runWorkspaceExport`, validate its
 * manifest, and reconstruct a `TemplatePayload` whose ids have been remapped
 * to fresh uuids. File blobs are returned alongside for the caller to re-host
 * via `getStorage().put(...)`.
 */
export async function importWorkspaceArchive(zipPath: string): Promise<WorkspaceArchiveResult> {
  const report = emptyReport('workspace-archive');
  const directory = await Open.file(zipPath);

  // 1. Manifest.
  const manifestFile = directory.files.find((f) => f.path === 'manifest.json');
  if (!manifestFile) throw new Error('archive is missing manifest.json');
  const manifestRaw = JSON.parse((await manifestFile.buffer()).toString('utf-8'));
  if (manifestRaw.format !== SUPPORTED_FORMAT) {
    throw new Error(
      `unsupported archive format: ${manifestRaw.format ?? 'unknown'} (expected ${SUPPORTED_FORMAT})`,
    );
  }

  // 2. Pages.
  const pageFiles = directory.files.filter(
    (f) => f.type === 'File' && /^pages\/[^/]+\.json$/.test(f.path),
  );
  const pages: TemplatePayload['pages'] = [];
  for (const pf of pageFiles) {
    const raw = JSON.parse((await pf.buffer()).toString('utf-8')) as RawPage;
    pages.push({
      id: raw.id,
      parentId: null,
      title: raw.title,
      icon: null,
      content: raw.content,
    });
  }

  // 3. Databases.
  const dbFiles = directory.files.filter(
    (f) => f.type === 'File' && /^databases\/[^/]+\.json$/.test(f.path),
  );
  const databases: TemplateDatabase[] = [];
  for (const df of dbFiles) {
    const raw = JSON.parse((await df.buffer()).toString('utf-8')) as RawDatabase;
    databases.push({
      id: raw.id,
      name: raw.name,
      properties: raw.properties.map((p, i) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        config: {},
        position: i,
      })),
      views: [],
      rows: raw.rows.map((r) => ({
        id: r.id,
        cells: Object.entries(r.cells).map(([propertyId, value]) => ({ propertyId, value })),
      })),
    });
  }

  // 4. File blobs — collected for the caller to re-host. Original archive
  //    paths are preserved (the path field on `files` rows points at these).
  const blobs = new Map<string, Buffer>();
  for (const f of directory.files) {
    if (f.type !== 'File' || !f.path.startsWith('files/')) continue;
    const blobPath = f.path.slice('files/'.length);
    blobs.set(blobPath, await f.buffer());
  }

  // 5. Flashcards section (optional; older archives omit it).
  let flashcards: FlashcardsArchive | null = null;
  const flashcardsFile = directory.files.find((f) => f.path === FLASHCARDS_ARCHIVE_PATH);
  if (flashcardsFile) {
    const raw = JSON.parse((await flashcardsFile.buffer()).toString('utf-8'));
    flashcards = {
      decks: Array.isArray(raw?.decks) ? raw.decks : [],
      cards: Array.isArray(raw?.cards) ? raw.cards : [],
    };
  }

  // 6. Remap → fresh uuids on every entity.
  const payload: TemplatePayload = {
    kind: 'page',
    rootPageId: pages[0]?.id,
    pages,
    databases,
  };
  const remap = buildRemap(payload);
  const rewritten = rewriteRefs(payload, remap);

  // Project out just the page-id portion of the remap for the flashcards
  // importer (the full remap also holds database/property/row/view ids).
  const pageIdRemap = new Map<string, string>();
  for (const p of pages) {
    const next = remap.get(p.id);
    if (next) pageIdRemap.set(p.id, next);
  }

  report.counts.pages = rewritten.pages.length;
  report.counts.databases = rewritten.databases.length;
  report.counts.rows = rewritten.databases.reduce((n, d) => n + d.rows.length, 0);
  report.counts.files = blobs.size;

  return {
    payload: rewritten,
    blobs,
    pageIdRemap,
    flashcards,
    manifest: {
      format: manifestRaw.format,
      counts: manifestRaw.counts ?? { pages: 0, databases: 0, files: 0 },
    },
    report,
  };
}
