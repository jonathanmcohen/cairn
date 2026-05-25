export const DEFAULT_COLUMN_WIDTH = 180;

export type ColumnErgonomics = {
  columnWidths: Record<string, number>;
  frozenColumnIds: string[];
  hiddenColumnIds: string[];
};

export type LaidOutColumn<T> = {
  id: string;
  prop: T;
  width: number;
  frozen: boolean;
  /** Cumulative left offset (px) for sticky positioning; null when not frozen. */
  insetInlineStart: number | null;
};

/**
 * Public, non-generic shape of a laid-out column used at render time. Consumers
 * (e.g. `<VirtualizedRowBody>`) only need the property fields `<CellEditor>`
 * reads (`id`, `name`, `type`, `config`), so this widens `prop` to a structural
 * minimum that matches `meta.properties[i]` from `useDatabaseData`.
 */
export type ColumnLayoutItem = LaidOutColumn<{
  id: string;
  name: string;
  type: string;
  config: unknown;
  // Allow extra fields without forcing every caller to know their shape.
  [k: string]: unknown;
}>;

/**
 * Turn a property list + view ergonomics config into render-ready columns:
 * hidden columns removed (order preserved), each column's width resolved
 * (config or DEFAULT_COLUMN_WIDTH), and frozen columns assigned a cumulative
 * inset-inline-start offset so they stack as a sticky prefix. Frozen offsets are
 * computed over the VISIBLE frozen columns only (a hidden frozen column claims
 * no slot). Logical-property naming keeps RTL correct.
 */
export function columnLayout<T extends { id: string }>(
  props: T[],
  cfg: ColumnErgonomics,
): LaidOutColumn<T>[] {
  const hidden = new Set(cfg.hiddenColumnIds);
  const frozen = new Set(cfg.frozenColumnIds);
  const visible = props.filter((p) => !hidden.has(p.id));

  // Frozen columns in their visible order (config order is informational; the
  // sticky stack follows render order, which is the property order here).
  let offset = 0;
  return visible.map((p) => {
    const width = cfg.columnWidths[p.id] ?? DEFAULT_COLUMN_WIDTH;
    const isFrozen = frozen.has(p.id);
    let insetInlineStart: number | null = null;
    if (isFrozen) {
      insetInlineStart = offset;
      offset += width;
    }
    return { id: p.id, prop: p, width, frozen: isFrozen, insetInlineStart };
  });
}
