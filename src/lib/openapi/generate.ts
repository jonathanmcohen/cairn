/**
 * Generates the OpenAPI 3.1 document for the Cairn public v1 API.
 *
 * Pure — no I/O. Called per-request by `/openapi.json` (cached per process),
 * and at test-time by `tests/openapi/generate.test.ts` to validate the spec.
 */
import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { buildRegistry } from './registry';

export type OpenApiDocument = ReturnType<OpenApiGeneratorV31['generateDocument']>;

export type GenerateOptions = {
  /** Public origin for the `servers` entry (pass `await publicOrigin()`). */
  serverUrl?: string;
  /** Document version (pass `appVersion()`). */
  version?: string;
};

export function generateOpenApiDocument(options: GenerateOptions = {}): OpenApiDocument {
  const registry = buildRegistry();
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Cairn API',
      version: options.version ?? process.env.npm_package_version ?? '0.9.0',
      description:
        'Self-hosted Notion-style block-based notes. The /api/v1 surface is the stable public API — workspace-scoped, role-gated, PAT-bearer-token authenticated.',
    },
    servers: [{ url: options.serverUrl ?? process.env.PUBLIC_URL ?? 'http://localhost:3000' }],
    tags: [
      { name: 'Pages', description: 'Page CRUD' },
      { name: 'Databases', description: 'Inline-database + row CRUD' },
    ],
  });
}
