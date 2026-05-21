import { evaluate, type FormulaContext } from './evaluate';
import { parseFormula } from './parse';

export type { FormulaContext } from './evaluate';
export type FormulaResult = unknown | { __error: string };

/**
 * Parse + evaluate a formula expression against a row's context.
 * Never throws: any parse/eval fault is returned as `{ __error: string }`.
 */
export function computeFormula(expression: string, ctx: FormulaContext): FormulaResult {
  try {
    return evaluate(parseFormula(expression), ctx);
  } catch (err) {
    return { __error: err instanceof Error ? err.message : 'formula error' };
  }
}
