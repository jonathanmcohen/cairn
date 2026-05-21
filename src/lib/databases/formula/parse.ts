import type { Ast, BinOp } from './ast';

export class FormulaParseError extends Error {}

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'ident'; v: string }
  | { t: 'op'; v: string }
  | { t: 'lparen' }
  | { t: 'rparen' }
  | { t: 'comma' };

const OPS = ['==', '!=', '<=', '>=', '<', '>', '+', '-', '*', '/', '%'];

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i] as string;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '(') {
      tokens.push({ t: 'lparen' });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ t: 'rparen' });
      i += 1;
      continue;
    }
    if (ch === ',') {
      tokens.push({ t: 'comma' });
      i += 1;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== '"') {
        s += src[j];
        j += 1;
      }
      if (src[j] !== '"') throw new FormulaParseError('unterminated string');
      tokens.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j] as string)) j += 1;
      const num = Number(src.slice(i, j));
      if (!Number.isFinite(num)) throw new FormulaParseError('bad number');
      tokens.push({ t: 'num', v: num });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j] as string)) j += 1;
      tokens.push({ t: 'ident', v: src.slice(i, j) });
      i = j;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      tokens.push({ t: 'op', v: op });
      i += op.length;
      continue;
    }
    throw new FormulaParseError(`unexpected character: ${ch}`);
  }
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): Ast {
    const ast = this.parseComparison();
    if (this.pos !== this.tokens.length) throw new FormulaParseError('trailing tokens');
    return ast;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private eatOp(values: string[]): string | undefined {
    const tok = this.peek();
    if (tok && tok.t === 'op' && values.includes(tok.v)) {
      this.pos += 1;
      return tok.v;
    }
    return undefined;
  }

  private parseComparison(): Ast {
    let left = this.parseAdditive();
    for (;;) {
      const op = this.eatOp(['==', '!=', '<', '<=', '>', '>=']);
      if (!op) break;
      left = { kind: 'bin', op: op as BinOp, left, right: this.parseAdditive() };
    }
    return left;
  }

  private parseAdditive(): Ast {
    let left = this.parseMultiplicative();
    for (;;) {
      const op = this.eatOp(['+', '-']);
      if (!op) break;
      left = { kind: 'bin', op: op as BinOp, left, right: this.parseMultiplicative() };
    }
    return left;
  }

  private parseMultiplicative(): Ast {
    let left = this.parsePrimary();
    for (;;) {
      const op = this.eatOp(['*', '/', '%']);
      if (!op) break;
      left = { kind: 'bin', op: op as BinOp, left, right: this.parsePrimary() };
    }
    return left;
  }

  private parsePrimary(): Ast {
    const tok = this.peek();
    if (!tok) throw new FormulaParseError('unexpected end of input');

    if (tok.t === 'num') {
      this.pos += 1;
      return { kind: 'num', value: tok.v };
    }
    if (tok.t === 'str') {
      this.pos += 1;
      return { kind: 'str', value: tok.v };
    }
    if (tok.t === 'lparen') {
      this.pos += 1;
      const inner = this.parseComparison();
      if (this.peek()?.t !== 'rparen') throw new FormulaParseError('expected )');
      this.pos += 1;
      return inner;
    }
    if (tok.t === 'ident') {
      this.pos += 1;
      if (tok.v === 'true') return { kind: 'bool', value: true };
      if (tok.v === 'false') return { kind: 'bool', value: false };
      // function call?
      if (this.peek()?.t === 'lparen') {
        this.pos += 1;
        const args: Ast[] = [];
        if (this.peek()?.t !== 'rparen') {
          args.push(this.parseComparison());
          while (this.peek()?.t === 'comma') {
            this.pos += 1;
            args.push(this.parseComparison());
          }
        }
        if (this.peek()?.t !== 'rparen') throw new FormulaParseError('expected )');
        this.pos += 1;
        // prop("Name") sugar → a reference
        if (tok.v === 'prop' && args.length === 1 && args[0]?.kind === 'str') {
          return { kind: 'ref', name: args[0].value };
        }
        return { kind: 'call', name: tok.v, args };
      }
      return { kind: 'ref', name: tok.v };
    }
    throw new FormulaParseError('unexpected token');
  }
}

export function parseFormula(src: string): Ast {
  return new Parser(tokenize(src)).parse();
}
