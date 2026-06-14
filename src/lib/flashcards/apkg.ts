import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { ZipArchive } from 'archiver';
import { and, asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import * as schema from '@/db/schema';
import { listDeckTree } from './decks';

// archiver v8 is pure ESM and exposes format classes (e.g. `ZipArchive`) rather
// than the old `archiver('zip', opts)` factory. @types/archiver still ships the
// v7 shape; the v8 export is augmented in src/lib/markdown/export-subtree.ts —
// that augmentation is global, so this file just uses the `ZipArchive` import.

/**
 * Anki `.apkg` (Anki 2.1) export for a workspace's flashcards (v0.10.2 F3-C).
 *
 * An `.apkg` is a ZIP containing:
 *   - `collection.anki2` — a legacy SQLite DB (schema version 11) built
 *     in-memory with sql.js. Tables: `col` (one row: models + decks + conf
 *     JSON), `notes`, `cards`, plus empty `revlog`/`graves` so importers that
 *     expect them don't choke.
 *   - `media` — a JSON object mapping numeric filenames → media names. We export
 *     no media, so it's `{}`.
 *
 * Mapping (Cairn → Anki):
 *   - Deck tree → Anki decks named with `::`-joined hierarchy (the parentDeckId
 *     chain from `listDeckTree`). A synthetic "Cairn" deck catches cards with no
 *     `deckId`.
 *   - Each Cairn card → one Anki note (Basic model: Front/Back) + one Anki card.
 *   - Per-user SM-2 state (the exporting user's `flashcard_reviews` row):
 *       ease (≈2.5)  → factor = round(ease * 1000)
 *       interval (d) → ivl
 *       has a review row → type=2, queue=2 (review)
 *       no review row   → type=0, queue=0 (new)
 *       suspendedAt set → queue=-1 (suspended; overrides the above)
 *   - Orphan cards (sourceOrphanedAt set) → exported under their deck with an
 *     extra `cairn-orphan` tag on the note.
 */

// `listDeckTree` declares a wider handle (select+insert+update+delete) even
// though it only reads; match it so buildApkg can forward `db` to it. The route
// passes the full `getDb()` handle, so this costs nothing at the call site.
type Db = Pick<PostgresJsDatabase<typeof schema>, 'select' | 'insert' | 'update' | 'delete'>;

export type BuildApkgInput = {
  workspaceId: string;
  userId: string;
};

/** The Anki field separator (0x1f) that joins Front\x1fBack inside `notes.flds`. */
const FIELD_SEP = '\x1f';
/** Synthetic deck name for cards that have no Cairn deck. */
const FALLBACK_DECK_NAME = 'Cairn';
/** Tag stamped on notes whose source card is orphaned. */
const ORPHAN_TAG = 'cairn-orphan';
/** Fixed model id for the Basic (Front/Back) note type. */
const BASIC_MODEL_ID = 1_000_000_000_001;

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

/**
 * Instantiate sql.js once. Two standalone-build hazards are handled here:
 *
 *  1. Locating the package on disk. Turbopack rewrites `require`/`require.resolve`
 *     obtained from a normal `import { createRequire } from 'node:module'` into
 *     its own bundler shim: a literal `require.resolve('sql.js')` gets folded to
 *     a NUMERIC module id (so `path.dirname(<number>)` throws), and a dynamic
 *     specifier throws "Cannot find module as expression is too dynamic". We
 *     escape the rewrite by pulling the REAL Node builtins from
 *     `process.getBuiltinModule(...)` (Node 22.3+), which Turbopack does not
 *     intercept — so `nodeRequire.resolve('sql.js')` is a genuine Node
 *     resolution returning the on-disk path. (sql.js is `serverExternalPackages`
 *     in next.config, so the package itself lives in the standalone
 *     node_modules where Node can find it.)
 *  2. Loading the wasm. The NFT file-tracer copies the package JS but NOT the
 *     sibling `sql-wasm.wasm` (it's not a JS import), so the route force-includes
 *     the wasm in the build trace (outputFileTracingIncludes). We read those
 *     bytes and hand sql.js `wasmBinary` directly — bypassing its
 *     `locateFile`/`fetch` loader, which in a server bundle would try to
 *     `fetch()` a filesystem path.
 */
function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    // Real Node builtins (NOT the static `import`s) so Turbopack leaves these
    // resolutions as genuine runtime Node calls — see hazard 1 above.
    const nodeRequire = process.getBuiltinModule('module').createRequire(import.meta.url);
    const fs = process.getBuiltinModule('fs');
    const nodePath = process.getBuiltinModule('path');
    const mainPath = nodeRequire.resolve('sql.js');
    const wasmPath = nodePath.join(nodePath.dirname(mainPath), 'sql-wasm.wasm');
    // readFileSync returns a Buffer (pooled); slice to a tight ArrayBuffer so it
    // matches initSqlJs's `wasmBinary: ArrayBuffer` type without a pooled-offset tail.
    const buf = fs.readFileSync(wasmPath);
    const wasmBinary = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    sqlJsPromise = initSqlJs({ wasmBinary });
  }
  return sqlJsPromise;
}

type DeckRow = Awaited<ReturnType<typeof listDeckTree>>[number];

/**
 * Resolve each deck's `::`-joined hierarchy name from the parentDeckId chain.
 * Cycles can't occur (reparentDeck guards them) but we cap the walk defensively.
 */
function buildDeckPaths(decks: DeckRow[]): Map<string, string> {
  const byId = new Map(decks.map((d) => [d.id, d]));
  const paths = new Map<string, string>();
  for (const deck of decks) {
    const parts: string[] = [];
    let cur: DeckRow | undefined = deck;
    let guard = 0;
    while (cur && guard < 256) {
      parts.unshift(cur.name);
      cur = cur.parentDeckId ? byId.get(cur.parentDeckId) : undefined;
      guard += 1;
    }
    paths.set(deck.id, parts.join('::'));
  }
  return paths;
}

/** SHA-1-based field checksum Anki stores in `notes.csum` (first field, lo 8 hex). */
function fieldChecksum(firstField: string): number {
  const digest = createHash('sha1').update(firstField, 'utf8').digest('hex');
  return Number.parseInt(digest.slice(0, 8), 16);
}

/** Strip a trivially HTML-unsafe character set so fields render cleanly in Anki. */
function toField(text: string): string {
  // Anki fields are HTML; our front/back are plain text. Escape the angle
  // brackets / ampersand so they survive as literal text rather than markup.
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function basicModelJson(): Record<string, unknown> {
  // Minimal Anki "Basic" model: two fields (Front, Back), one card template
  // (Card 1) rendering Front on the question and FrontSide+Back on the answer.
  return {
    [BASIC_MODEL_ID]: {
      id: BASIC_MODEL_ID,
      name: 'Basic',
      type: 0,
      mod: 0,
      usn: -1,
      sortf: 0,
      did: 1,
      tmpls: [
        {
          name: 'Card 1',
          ord: 0,
          qfmt: '{{Front}}',
          afmt: '{{FrontSide}}\n\n<hr id="answer">\n\n{{Back}}',
          bqfmt: '',
          bafmt: '',
          did: null,
          bfont: '',
          bsize: 0,
        },
      ],
      flds: [
        { name: 'Front', ord: 0, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] },
        { name: 'Back', ord: 1, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] },
      ],
      css: '.card {\n font-family: arial;\n font-size: 20px;\n text-align: center;\n color: black;\n background-color: white;\n}\n',
      latexPre:
        '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n',
      latexPost: '\\end{document}',
      latexsvg: false,
      req: [[0, 'any', [0]]],
      vers: [],
      tags: [],
    },
  };
}

function defaultDeckConf(): Record<string, unknown> {
  return {
    1: {
      id: 1,
      name: 'Default',
      replayq: true,
      lapse: { delays: [10], mult: 0, minInt: 1, leechFails: 8, leechAction: 1 },
      rev: {
        perDay: 200,
        ease4: 1.3,
        fuzz: 0.05,
        minSpace: 1,
        ivlFct: 1,
        maxIvl: 36500,
        bury: true,
        hardFactor: 1.2,
      },
      timer: 0,
      maxTaken: 60,
      usn: -1,
      new: {
        perDay: 20,
        delays: [1, 10],
        separate: true,
        ints: [1, 4, 7],
        initialFactor: 2500,
        bury: true,
        order: 1,
      },
      mod: 0,
      autoplay: true,
    },
  };
}

function collectionConf(): Record<string, unknown> {
  return {
    nextPos: 1,
    estTimes: true,
    activeDecks: [1],
    sortType: 'noteFld',
    timeLim: 0,
    sortBackwards: false,
    addToCur: true,
    curDeck: 1,
    newBury: true,
    newSpread: 0,
    dueCounts: true,
    curModel: String(BASIC_MODEL_ID),
    collapseTime: 1200,
  };
}

/**
 * Build the `.apkg` ZIP for a workspace. Returns the zip bytes. Pure-ish
 * (db-injected, no clock leak beyond `Date.now()` for Anki ids) so it's
 * unit-testable.
 */
export async function buildApkg(db: Db, input: BuildApkgInput): Promise<Uint8Array> {
  const { workspaceId, userId } = input;

  const decks = await listDeckTree(db, workspaceId);
  const deckPaths = buildDeckPaths(decks);

  const cards = await db
    .select({
      id: schema.flashcardCards.id,
      front: schema.flashcardCards.front,
      back: schema.flashcardCards.back,
      deckId: schema.flashcardCards.deckId,
      tags: schema.flashcardCards.tags,
      sourceOrphanedAt: schema.flashcardCards.sourceOrphanedAt,
      suspendedAt: schema.flashcardCards.suspendedAt,
      ease: schema.flashcardReviews.ease,
      interval: schema.flashcardReviews.interval,
      reps: schema.flashcardReviews.reps,
      hasReview: schema.flashcardReviews.cardId,
    })
    .from(schema.flashcardCards)
    .leftJoin(
      schema.flashcardReviews,
      and(
        eq(schema.flashcardReviews.cardId, schema.flashcardCards.id),
        eq(schema.flashcardReviews.userId, userId),
      ),
    )
    .where(eq(schema.flashcardCards.workspaceId, workspaceId))
    .orderBy(asc(schema.flashcardCards.id));

  const anki2 = await buildCollectionDb({ decks, deckPaths, cards });
  return zipApkg(anki2);
}

type CardRow = {
  id: string;
  front: string;
  back: string;
  deckId: string | null;
  tags: string[];
  sourceOrphanedAt: Date | null;
  suspendedAt: Date | null;
  ease: number | null;
  interval: number | null;
  reps: number | null;
  hasReview: string | null;
};

/** Build the in-memory collection.anki2 SQLite DB and return its bytes. */
async function buildCollectionDb(args: {
  decks: DeckRow[];
  deckPaths: Map<string, string>;
  cards: CardRow[];
}): Promise<Uint8Array> {
  const SQL = await getSqlJs();
  const adb = new SQL.Database();
  try {
    adb.run(SCHEMA_SQL);

    const now = Date.now();
    const crt = Math.floor(now / 1000);

    // --- decks JSON: a numeric id per deck path, plus the always-present
    //     "Default" deck (id 1) and a synthetic fallback for deck-less cards.
    const decksJson: Record<string, unknown> = {
      1: deckConfEntry(1, 'Default'),
    };
    // Map Cairn deck-id → numeric Anki deck-id (stable hash of path/index+2).
    const deckNumByCairnId = new Map<string, number>();
    let nextDeckNum = 2;
    for (const deck of args.decks) {
      const num = nextDeckNum++;
      deckNumByCairnId.set(deck.id, num);
      decksJson[String(num)] = deckConfEntry(num, args.deckPaths.get(deck.id) ?? deck.name);
    }
    // Fallback deck for cards with no deckId.
    const fallbackNum = nextDeckNum++;
    decksJson[String(fallbackNum)] = deckConfEntry(fallbackNum, FALLBACK_DECK_NAME);

    // --- col row.
    const insertCol = adb.prepare(
      `INSERT INTO col (id, crt, mod, scm, ver, dty, usn, ls, conf, models, decks, dconf, tags)
       VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, ?)`,
    );
    insertCol.run([
      crt,
      now,
      now,
      JSON.stringify(collectionConf()),
      JSON.stringify(basicModelJson()),
      JSON.stringify(decksJson),
      JSON.stringify(defaultDeckConf()),
      JSON.stringify({}),
    ]);
    insertCol.free();

    const insertNote = adb.prepare(
      `INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
       VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, '')`,
    );
    const insertCard = adb.prepare(
      `INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
       VALUES (?, ?, ?, 0, ?, -1, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, '')`,
    );

    let idSeq = now;
    let due = 1;
    for (const card of args.cards) {
      const noteId = idSeq++;
      const cardId = idSeq++;
      const front = toField(card.front);
      const back = toField(card.back);
      const flds = `${front}${FIELD_SEP}${back}`;
      const sfld = front;
      const tags = [...card.tags];
      if (card.sourceOrphanedAt) tags.push(ORPHAN_TAG);
      // Anki stores tags space-delimited, with a leading+trailing space.
      const tagStr = tags.length > 0 ? ` ${tags.join(' ')} ` : '';

      insertNote.run([
        noteId,
        guidFor(card.id),
        BASIC_MODEL_ID,
        crt,
        tagStr,
        flds,
        sfld,
        fieldChecksum(front),
      ]);

      const did = card.deckId ? (deckNumByCairnId.get(card.deckId) ?? fallbackNum) : fallbackNum;
      const ivl = card.interval ?? 0;
      const factor = card.ease != null ? Math.round(card.ease * 1000) : 0;
      const reps = card.reps ?? 0;
      // type/queue mapping.
      let type: number;
      let queue: number;
      if (card.hasReview != null) {
        type = 2; // review
        queue = 2;
      } else {
        type = 0; // new
        queue = 0;
      }
      if (card.suspendedAt) queue = -1; // suspended overrides

      insertCard.run([
        cardId,
        noteId,
        did,
        crt,
        type,
        queue,
        // `due` for new cards is a position; for review cards it's a day number.
        // A simple incrementing position is import-safe for both.
        due++,
        ivl,
        factor,
        reps,
      ]);
    }
    insertNote.free();
    insertCard.free();

    return adb.export();
  } finally {
    adb.close();
  }
}

/** A stable, deterministic Anki GUID derived from the Cairn card id. */
function guidFor(cardId: string): string {
  // Anki guids are short base91-ish strings; a stable base64url slice of a hash
  // is unique and deterministic enough for re-import idempotency.
  return createHash('sha1').update(cardId).digest('base64url').slice(0, 10);
}

function deckConfEntry(id: number, name: string): Record<string, unknown> {
  return {
    id,
    name,
    mod: 0,
    usn: -1,
    lrnToday: [0, 0],
    revToday: [0, 0],
    newToday: [0, 0],
    timeToday: [0, 0],
    collapsed: false,
    browserCollapsed: false,
    desc: '',
    dyn: 0,
    conf: 1,
    extendNew: 0,
    extendRev: 0,
  };
}

/** Zip the collection.anki2 + an empty media manifest into the .apkg bytes. */
async function zipApkg(anki2: Uint8Array): Promise<Uint8Array> {
  const pass = new PassThrough();
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  const done = new Promise<void>((resolve, reject) => {
    pass.on('data', (c: Buffer) => chunks.push(c));
    pass.on('end', resolve);
    pass.on('error', reject);
    archive.on('error', reject);
  });
  archive.pipe(pass);
  archive.append(Buffer.from(anki2), { name: 'collection.anki2' });
  archive.append('{}', { name: 'media' });
  await archive.finalize();
  await done;
  return new Uint8Array(Buffer.concat(chunks));
}

/**
 * Legacy Anki 2.1 (schema version 11) collection schema. Column sets mirror the
 * tables Anki creates so AnkiDesktop / AnkiDroid import without complaint.
 */
const SCHEMA_SQL = `
CREATE TABLE col (
  id     integer PRIMARY KEY,
  crt    integer NOT NULL,
  mod    integer NOT NULL,
  scm    integer NOT NULL,
  ver    integer NOT NULL,
  dty    integer NOT NULL,
  usn    integer NOT NULL,
  ls     integer NOT NULL,
  conf   text NOT NULL,
  models text NOT NULL,
  decks  text NOT NULL,
  dconf  text NOT NULL,
  tags   text NOT NULL
);
CREATE TABLE notes (
  id    integer PRIMARY KEY,
  guid  text NOT NULL,
  mid   integer NOT NULL,
  mod   integer NOT NULL,
  usn   integer NOT NULL,
  tags  text NOT NULL,
  flds  text NOT NULL,
  sfld  integer NOT NULL,
  csum  integer NOT NULL,
  flags integer NOT NULL,
  data  text NOT NULL
);
CREATE TABLE cards (
  id     integer PRIMARY KEY,
  nid    integer NOT NULL,
  did    integer NOT NULL,
  ord    integer NOT NULL,
  mod    integer NOT NULL,
  usn    integer NOT NULL,
  type   integer NOT NULL,
  queue  integer NOT NULL,
  due    integer NOT NULL,
  ivl    integer NOT NULL,
  factor integer NOT NULL,
  reps   integer NOT NULL,
  lapses integer NOT NULL,
  left   integer NOT NULL,
  odue   integer NOT NULL,
  odid   integer NOT NULL,
  flags  integer NOT NULL,
  data   text NOT NULL
);
CREATE TABLE revlog (
  id      integer PRIMARY KEY,
  cid     integer NOT NULL,
  usn     integer NOT NULL,
  ease    integer NOT NULL,
  ivl     integer NOT NULL,
  lastIvl integer NOT NULL,
  factor  integer NOT NULL,
  time    integer NOT NULL,
  type    integer NOT NULL
);
CREATE TABLE graves (
  usn  integer NOT NULL,
  oid  integer NOT NULL,
  type integer NOT NULL
);
CREATE INDEX ix_notes_usn ON notes (usn);
CREATE INDEX ix_cards_usn ON cards (usn);
CREATE INDEX ix_cards_nid ON cards (nid);
CREATE INDEX ix_cards_sched ON cards (did, queue, due);
CREATE INDEX ix_revlog_cid ON revlog (cid);
CREATE INDEX ix_notes_csum ON notes (csum);
`;
