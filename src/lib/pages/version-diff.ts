/**
 * Side-by-side block-level diff over ProseMirror docs from page_versions.
 *
 * The algorithm:
 * 1. Project each block to a `signature = (type, JSON(attrs))`.
 * 2. Run LCS over the two signature arrays.
 * 3. For each matched pair, emit `unchanged` if the block's full JSON is
 *    byte-identical, otherwise `changed` + a word-level inline diff over the
 *    block's plain text.
 * 4. For unmatched blocks, emit `removed` (left-only) or `added` (right-only).
 *
 * We do NOT use a ProseMirror Step-based diff: snapshots in page_versions are
 * raw JSON, not Step histories, so we'd have nothing to apply Steps against.
 * A structural walk is the right fit.
 */

export type PMNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
};

export type PMDoc = { type: 'doc'; content: PMNode[] };

export type InlineDiff = { kind: 'same' | 'add' | 'remove'; text: string };

export type DiffBlock =
  | { kind: 'unchanged'; index: number; block: PMNode }
  | { kind: 'added'; index: number; block: PMNode }
  | { kind: 'removed'; index: number; block: PMNode }
  | {
      kind: 'changed';
      oldIndex: number;
      newIndex: number;
      before: PMNode;
      after: PMNode;
      inlineDiff: InlineDiff[];
    };

function signature(node: PMNode): string {
  return `${node.type}|${JSON.stringify(node.attrs ?? {})}`;
}

/** Recursively collect plain text from a node's content tree. */
function nodeText(node: PMNode): string {
  if (typeof node.text === 'string') return node.text;
  if (!node.content) return '';
  return node.content.map(nodeText).join('');
}

/** Tokenize on whitespace, preserving runs of whitespace as their own tokens
 * so re-assembly is lossless. */
function tokenize(input: string): string[] {
  if (input.length === 0) return [];
  return input.match(/\S+|\s+/g) ?? [];
}

/**
 * Word-level diff via classic LCS over token arrays. Output preserves order:
 * remove(s) from A appear at their A-position; add(s) from B follow.
 */
function wordDiff(a: string, b: string): InlineDiff[] {
  const A = tokenize(a);
  const B = tokenize(b);
  const n = A.length;
  const m = B.length;
  const w = m + 1;
  const lcs = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] =
        A[i] === B[j]
          ? (lcs[(i + 1) * w + (j + 1)] ?? 0) + 1
          : Math.max(lcs[(i + 1) * w + j] ?? 0, lcs[i * w + (j + 1)] ?? 0);
    }
  }
  const out: InlineDiff[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push({ kind: 'same', text: A[i] as string });
      i++;
      j++;
    } else if ((lcs[(i + 1) * w + j] ?? 0) >= (lcs[i * w + (j + 1)] ?? 0)) {
      out.push({ kind: 'remove', text: A[i] as string });
      i++;
    } else {
      out.push({ kind: 'add', text: B[j] as string });
      j++;
    }
  }
  while (i < n) {
    out.push({ kind: 'remove', text: A[i++] as string });
  }
  while (j < m) {
    out.push({ kind: 'add', text: B[j++] as string });
  }
  return out;
}

/** LCS over signature arrays — returns the matched-pair (aIndex, bIndex) list. */
function lcsPairs(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const lcs = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] =
        a[i] === b[j]
          ? (lcs[(i + 1) * w + (j + 1)] ?? 0) + 1
          : Math.max(lcs[(i + 1) * w + j] ?? 0, lcs[i * w + (j + 1)] ?? 0);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if ((lcs[(i + 1) * w + j] ?? 0) >= (lcs[i * w + (j + 1)] ?? 0)) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

/**
 * Diff two ProseMirror snapshots block-by-block. Returns the merged sequence
 * of unchanged / added / removed / changed entries in left-to-right reading
 * order (i.e. the consumer can render the result as a unified column or fan
 * out into a side-by-side view using the indices).
 */
export function diffSnapshots(a: PMDoc, b: PMDoc): DiffBlock[] {
  const A = a.content ?? [];
  const B = b.content ?? [];
  const sigA = A.map(signature);
  const sigB = B.map(signature);
  const pairs = lcsPairs(sigA, sigB);

  const out: DiffBlock[] = [];
  let ai = 0;
  let bi = 0;
  for (const [pa, pb] of pairs) {
    // Everything in A before pa is removed.
    while (ai < pa) {
      out.push({ kind: 'removed', index: ai, block: A[ai] as PMNode });
      ai++;
    }
    // Everything in B before pb is added.
    while (bi < pb) {
      out.push({ kind: 'added', index: bi, block: B[bi] as PMNode });
      bi++;
    }
    const blockA = A[pa] as PMNode;
    const blockB = B[pb] as PMNode;
    if (JSON.stringify(blockA) === JSON.stringify(blockB)) {
      out.push({ kind: 'unchanged', index: ai, block: blockA });
    } else {
      out.push({
        kind: 'changed',
        oldIndex: ai,
        newIndex: bi,
        before: blockA,
        after: blockB,
        inlineDiff: wordDiff(nodeText(blockA), nodeText(blockB)),
      });
    }
    ai++;
    bi++;
  }
  // Trailing A → removed; trailing B → added.
  while (ai < A.length) {
    out.push({ kind: 'removed', index: ai, block: A[ai] as PMNode });
    ai++;
  }
  while (bi < B.length) {
    out.push({ kind: 'added', index: bi, block: B[bi] as PMNode });
    bi++;
  }
  return out;
}
