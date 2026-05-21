import { describe, expect, it } from 'vitest';
import { FormulaParseError, parseFormula } from '@/lib/databases/formula/parse';

describe('parseFormula', () => {
  it('parses number/string/boolean literals', () => {
    expect(parseFormula('42')).toEqual({ kind: 'num', value: 42 });
    expect(parseFormula('"hi"')).toEqual({ kind: 'str', value: 'hi' });
    expect(parseFormula('true')).toEqual({ kind: 'bool', value: true });
  });

  it('parses a bare property reference', () => {
    expect(parseFormula('Price')).toEqual({ kind: 'ref', name: 'Price' });
  });

  it('parses prop("...") for names with spaces', () => {
    expect(parseFormula('prop("Unit Price")')).toEqual({ kind: 'ref', name: 'Unit Price' });
  });

  it('respects arithmetic precedence', () => {
    expect(parseFormula('1 + 2 * 3')).toEqual({
      kind: 'bin',
      op: '+',
      left: { kind: 'num', value: 1 },
      right: {
        kind: 'bin',
        op: '*',
        left: { kind: 'num', value: 2 },
        right: { kind: 'num', value: 3 },
      },
    });
  });

  it('parses comparisons below arithmetic', () => {
    const ast = parseFormula('Qty * 2 >= 10');
    expect(ast).toMatchObject({ kind: 'bin', op: '>=' });
  });

  it('parses parenthesized grouping', () => {
    const ast = parseFormula('(1 + 2) * 3');
    expect(ast).toMatchObject({ kind: 'bin', op: '*', left: { kind: 'bin', op: '+' } });
  });

  it('parses function calls with args', () => {
    expect(parseFormula('round(Price)')).toEqual({
      kind: 'call',
      name: 'round',
      args: [{ kind: 'ref', name: 'Price' }],
    });
    expect(parseFormula('if(Done, 1, 0)')).toMatchObject({ kind: 'call', name: 'if' });
  });

  it('throws FormulaParseError on garbage', () => {
    expect(() => parseFormula('1 +')).toThrow(FormulaParseError);
    expect(() => parseFormula('(1 + 2')).toThrow(FormulaParseError);
    expect(() => parseFormula('@')).toThrow(FormulaParseError);
  });
});
