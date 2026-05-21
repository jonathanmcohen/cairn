/** A formula function receives already-evaluated argument values. Pure: no I/O. */
export type FormulaFn = (args: unknown[]) => unknown;

function toNum(v: unknown): number {
  const n = typeof v === 'boolean' ? (v ? 1 : 0) : Number(v);
  return Number.isFinite(n) ? n : Number.NaN;
}

function toDate(v: unknown): Date {
  if (v instanceof Date) return v;
  return new Date(String(v));
}

function truthy(v: unknown): boolean {
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  return Boolean(v);
}

const MS_PER = { days: 86_400_000, hours: 3_600_000, minutes: 60_000 } as const;

export const FORMULA_FUNCTIONS: Record<string, FormulaFn> = {
  if: (args) => (truthy(args[0]) ? args[1] : args[2]),
  concat: (args) => args.map((a) => (a === null || a === undefined ? '' : String(a))).join(''),
  length: (args) => String(args[0] ?? '').length,
  round: (args) => Math.round(toNum(args[0])),
  abs: (args) => Math.abs(toNum(args[0])),
  min: (args) => Math.min(...args.map(toNum)),
  max: (args) => Math.max(...args.map(toNum)),
  sum: (args) => args.reduce<number>((acc, a) => acc + toNum(a), 0),
  now: () => new Date(),
  dateDiff: (args) => {
    const a = toDate(args[0]).getTime();
    const b = toDate(args[1]).getTime();
    const unit = String(args[2] ?? 'days') as keyof typeof MS_PER;
    const per = MS_PER[unit];
    if (!per || !Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN;
    return Math.round((a - b) / per);
  },
};

export function isFormulaFunction(name: string): boolean {
  return Object.hasOwn(FORMULA_FUNCTIONS, name);
}
