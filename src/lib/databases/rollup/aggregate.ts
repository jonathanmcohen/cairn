import type { RollupFn } from './config';

/** Result of a rollup aggregation: a number, an ISO date string, or null/0. */
export type RollupResult = number | string | null;

function toNumbers(values: unknown[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue;
    const n = typeof v === 'boolean' ? (v ? 1 : 0) : Number(v);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function toDates(values: unknown[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue;
    const t = v instanceof Date ? v.getTime() : new Date(String(v)).getTime();
    if (Number.isFinite(t)) out.push(t);
  }
  return out;
}

/**
 * Aggregate an array of related-row cell values with `fn`.
 * Pure + synchronous. Empty/all-invalid → count=0, sum=0, everything else null.
 */
export function aggregate(fn: RollupFn, values: unknown[]): RollupResult {
  switch (fn) {
    case 'count':
      return values.length;
    case 'sum': {
      const nums = toNumbers(values);
      return nums.reduce((acc, n) => acc + n, 0);
    }
    case 'avg': {
      const nums = toNumbers(values);
      if (nums.length === 0) return null;
      return nums.reduce((acc, n) => acc + n, 0) / nums.length;
    }
    case 'min': {
      const nums = toNumbers(values);
      return nums.length === 0 ? null : Math.min(...nums);
    }
    case 'max': {
      const nums = toNumbers(values);
      return nums.length === 0 ? null : Math.max(...nums);
    }
    case 'earliest': {
      const times = toDates(values);
      return times.length === 0 ? null : new Date(Math.min(...times)).toISOString();
    }
    case 'latest': {
      const times = toDates(values);
      return times.length === 0 ? null : new Date(Math.max(...times)).toISOString();
    }
  }
}
