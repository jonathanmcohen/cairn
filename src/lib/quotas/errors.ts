export class QuotaExceededError extends Error {
  readonly limit: number;
  readonly used: number;
  readonly incoming: number;
  constructor(args: { limit: number; used: number; incoming: number }) {
    super(`Storage quota exceeded: ${args.used} + ${args.incoming} > ${args.limit} bytes`);
    this.name = 'QuotaExceededError';
    this.limit = args.limit;
    this.used = args.used;
    this.incoming = args.incoming;
  }
}
