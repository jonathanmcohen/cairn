/**
 * Side-effect import that augments Zod's prototype with `.openapi()`.
 * Import this once at every entry point that builds the spec or registers
 * schemas — calling it more than once is a no-op (the library is idempotent).
 */
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export { z };
