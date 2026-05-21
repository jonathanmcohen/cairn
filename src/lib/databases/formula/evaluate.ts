import type { Ast } from './ast';
import { FORMULA_FUNCTIONS, isFormulaFunction } from './functions';

export type FormulaContext = {
  /** property name -> property id */
  nameToId: Map<string, string>;
  /** property id -> resolved cell value */
  cells: Record<string, unknown>;
};

/** Thrown internally; computeFormula (index.ts) catches and converts to {__error}. */
export class FormulaEvalError extends Error {}

function num(v: unknown): number {
  const n = typeof v === 'boolean' ? (v ? 1 : 0) : Number(v);
  if (!Number.isFinite(n)) throw new FormulaEvalError(`not a number: ${String(v)}`);
  return n;
}

export function evaluate(ast: Ast, ctx: FormulaContext): unknown {
  switch (ast.kind) {
    case 'num':
      return ast.value;
    case 'str':
      return ast.value;
    case 'bool':
      return ast.value;
    case 'ref': {
      const id = ctx.nameToId.get(ast.name);
      if (!id) throw new FormulaEvalError(`unknown property: ${ast.name}`);
      return ctx.cells[id] ?? null;
    }
    case 'call': {
      if (!isFormulaFunction(ast.name)) {
        throw new FormulaEvalError(`unknown function: ${ast.name}`);
      }
      const args = ast.args.map((a) => evaluate(a, ctx));
      const out = FORMULA_FUNCTIONS[ast.name]?.(args);
      if (typeof out === 'number' && !Number.isFinite(out)) {
        throw new FormulaEvalError(`${ast.name} produced a non-finite value`);
      }
      return out;
    }
    case 'bin': {
      const l = evaluate(ast.left, ctx);
      const r = evaluate(ast.right, ctx);
      switch (ast.op) {
        case '+':
          // string concat if either side is a string
          if (typeof l === 'string' || typeof r === 'string') return `${String(l)}${String(r)}`;
          return num(l) + num(r);
        case '-':
          return num(l) - num(r);
        case '*':
          return num(l) * num(r);
        case '/': {
          const d = num(r);
          if (d === 0) throw new FormulaEvalError('division by zero');
          return num(l) / d;
        }
        case '%': {
          const d = num(r);
          if (d === 0) throw new FormulaEvalError('modulo by zero');
          return num(l) % d;
        }
        case '==':
          return l === r;
        case '!=':
          return l !== r;
        case '<':
          return num(l) < num(r);
        case '<=':
          return num(l) <= num(r);
        case '>':
          return num(l) > num(r);
        case '>=':
          return num(l) >= num(r);
      }
    }
  }
}
