export type BinOp = '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '<' | '<=' | '>' | '>=';

export type Ast =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'ref'; name: string }
  | { kind: 'bin'; op: BinOp; left: Ast; right: Ast }
  | { kind: 'call'; name: string; args: Ast[] };
